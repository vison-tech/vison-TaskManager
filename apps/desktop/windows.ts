import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLauncherArgs } from './config.ts';
import { runLauncher } from './commands.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2);

async function main(): Promise<void> {
  const args = parseLauncherArgs(argv);
  // Keep persistent files outside the install directory, on the selected disk.
  // Separate Windows accounts so one user's launcher cannot control another's.
  const home = resolve(process.env.TASKMANAGER_HOME || join(dirname(dirname(root)), 'TaskManager-data', userInfo().username));
  const configDir = args.configDir ?? join(home, 'config');
  const options = [...argv];
  if (!args.configDir) options.push('--config-dir', configDir);
  if (args.command === 'start') {
    if (args.overrides.mode === 'embed') throw new Error('Windows 安装版目前支持浏览器模式，请使用 --mode web。');
    if (!args.overrides.mode) options.push('--mode', 'web');
    if (args.overrides.launchHost === undefined) options.push('--no-launch');
    if (!args.overrides.dataDir && !process.env.TASKMANAGER_DATA_DIR && !existsSync(join(configDir, 'launcher.json'))) {
      options.push('--data-dir', join(home, 'data'));
    }
    console.log('TaskManager：请保持此窗口打开。按 Ctrl+C 或使用“停止 TaskManager”快捷方式退出。');
  }
  await runLauncher(options, root, {
    bundled: true,
    onRunning(config) {
      const url = `http://127.0.0.1:${config.port}`;
      if (process.env.TASKMANAGER_NO_BROWSER === '1') return;
      const browser = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [url], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      browser.on('error', () => console.log(`请在浏览器打开 ${url}`));
      browser.unref();
    },
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'TaskManager 启动失败。');
  process.exitCode = 1;
});
