import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultLauncherDirectory, parseLauncherArgs, resolveLauncherConfig, saveLauncherConfig } from './config.ts';
import { createLauncherLogger } from './logs.ts';
import { acquireLauncherLock, readLauncherStatus, requestLauncherStop } from './state.ts';
import { assertLauncherAssets, assertLauncherPort } from './preflight.ts';
import { superviseLauncher } from './supervisor.ts';

export interface LauncherOptions { bundled?: boolean; signal?: AbortSignal }

export const launcherHelp = `TaskManager 一键启动（源码版，需要 Node.js 24+）

首次启动：npm run launch -- --data-dir <现有数据目录> --port 47831
以后启动：npm run launch，或双击 TaskManager.command
查看状态：npm run launch -- status
安全停止：npm run launch -- stop
最近日志：npm run launch -- logs

选项：--mode embed|web  --cdp-port 9231  --no-launch  --launch-host
      --config-dir <配置目录>  --help

首次选择的数据目录和端口会保存；启动后保持当前终端打开。
--mode web 只运行浏览器看板；按输出地址打开。
--no-launch 仅连接已经开启调试端口的 Codex。
Ctrl+C 或 stop 会先卸载注入器，再关闭本次启动的服务。`;

function printStatus(dir: string): void {
  const current = readLauncherStatus(dir);
  if (current.status === 'stopped') console.log('TaskManager 启动器未运行。');
  else if (current.status === 'active' && current.state) {
    console.log(`TaskManager: ${current.state.phase} (${current.state.mode})\nhttp://127.0.0.1:${current.state.port}\n日志：${join(dir, 'launcher.log')}`);
  } else {
    throw new Error(`启动状态为 ${current.status}。请检查旧启动器已退出，再移除 ${join(dir, 'running')} 后重试；未终止任何进程。`);
  }
}

async function stopLauncher(dir: string): Promise<void> {
  const request = requestLauncherStop(dir);
  if (!request.requested) { printStatus(dir); return; }
  console.log('已请求停止，正在等待面板卸载与服务退出…');
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const current = readLauncherStatus(dir);
    if (current.status === 'stopped' || (current.status === 'active' && current.state && current.state.instanceId !== request.state?.instanceId)) {
      console.log('原启动器已退出。');
      return;
    }
    if (current.status !== 'active') throw new Error('启动器意外退出，清理结果未确认。请检查日志和 running 目录。');
    await delay(250);
  }
  throw new Error('启动器尚未确认停止，请检查原终端和日志；没有按保存的 PID 强制结束进程。');
}

async function launch(dir: string, config: ReturnType<typeof resolveLauncherConfig>, root: string, options: LauncherOptions): Promise<void> {
  if (options.signal?.aborted) return;
  await assertLauncherAssets(root);
  if (options.signal?.aborted) return;
  const lock = acquireLauncherLock(dir, config);
  const controller = new AbortController();
  let logger: ReturnType<typeof createLauncherLogger> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let logFailure: unknown;
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  const log = (source: string, chunk: Buffer | string) => {
    if (logFailure) return;
    try { logger?.write(source, chunk); }
    catch (error) {
      logFailure = error;
      console.error('无法写入启动日志，正在停止本次启动的进程。');
      controller.abort();
    }
  };
  try {
    const secrets = Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY/i.test(name))
      .map(([, value]) => value).filter((value): value is string => !!value);
    logger = createLauncherLogger(dir, secrets, (line) => console.log(line));
    let lastHeartbeat = 0;
    timer = setInterval(() => {
      try {
        if (lock.stopRequested()) controller.abort();
        if (Date.now() - lastHeartbeat > 2000) { lock.heartbeat(); lastHeartbeat = Date.now(); }
      } catch {
        log('launcher', 'Launcher state is no longer writable or owned. Stopping owned processes.\n');
        controller.abort();
        logFailure ??= new Error('Launcher state could not be maintained.');
      }
    }, 250);
    if (controller.signal.aborted) return;
    await assertLauncherPort(config.port);
    if (controller.signal.aborted) return;
    saveLauncherConfig(dir, config);
    log('launcher', `Starting ${config.mode}; data directory: ${config.dataDir}\n`);
    await superviseLauncher({
      config, root, instanceId: lock.state.instanceId, signal: controller.signal, log, bundled: options.bundled,
      onRunning: () => lock.update('running'), onStopping: () => lock.update('stopping'),
    });
    if (logFailure) throw new Error('启动器因日志或状态保存失败而停止。');
    log('launcher', 'Stopped.\n');
  } catch (error) {
    log('launcher', `${error instanceof Error ? error.message : 'Launcher failed.'}\n`);
    // Errors have already passed through the redacting logger.
    throw new Error(`TaskManager 启动或运行失败。请查看上方提示和 ${join(dir, 'launcher.log')}`);
  } finally {
    clearInterval(timer);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.off('SIGHUP', stop);
    options.signal?.removeEventListener('abort', stop);
    try { logger?.flush(); } finally { lock.release(); }
  }
}

export async function runLauncher(argv: string[], root: string, options: LauncherOptions = {}): Promise<void> {
  const args = parseLauncherArgs(argv);
  if (args.command === 'help') {
    console.log(options.bundled ? 'TaskManager 内置运行环境。通过应用窗口选择数据目录并启动；命令行支持 start / status / stop / logs。' : launcherHelp);
    return;
  }
  const dir = args.configDir ?? defaultLauncherDirectory();
  if (args.command === 'status') { printStatus(dir); return; }
  if (args.command === 'stop') { await stopLauncher(dir); return; }
  if (args.command === 'logs') {
    const path = join(dir, 'launcher.log');
    console.log(existsSync(path) ? readFileSync(path, 'utf8').trimEnd().split('\n').slice(-80).join('\n') : '暂无启动日志。');
    return;
  }
  const config = resolveLauncherConfig(dir, args.overrides);
  await launch(dir, config, root, options);
}
