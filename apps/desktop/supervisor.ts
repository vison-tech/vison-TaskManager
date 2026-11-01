import { join } from 'node:path';
import type { LauncherConfig, LauncherReady } from '../../packages/contracts/desktop.ts';
import { spawnOwnedChild, type ChildOptions, type OwnedChild } from './children.ts';

export interface SupervisorOptions {
  config: LauncherConfig; root: string; instanceId: string; signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  log: (source: string, chunk: Buffer | string) => void;
  onRunning: () => void;
  onStopping: () => void;
  spawnChild?: (options: ChildOptions) => OwnedChild;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  bundled?: boolean;
}

/** The server's IPC acknowledgement proves readiness came from this launch's child. */
export async function superviseLauncher(options: SupervisorOptions): Promise<void> {
  const children: Array<{ role: LauncherReady['role']; child: OwnedChild }> = [];
  const { config, signal, log } = options;
  const startup = new AbortController();
  const startupSignal = AbortSignal.any([signal, startup.signal]);
  const readyTimeout = options.readyTimeoutMs ?? 60_000;
  const env = { ...(options.env ?? process.env), TASKMANAGER_DATA_DIR: config.dataDir,
    PORT: String(config.port), HOST: '127.0.0.1' };
  let stopListener = () => {};
  const requestedStop = new Promise<void>((resolve) => {
    stopListener = resolve;
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', stopListener, { once: true });
  });
  const start = async (role: LauncherReady['role'], args: string[]) => {
    if (signal.aborted) throw new Error('Launcher startup cancelled.');
    const child = (options.spawnChild ?? spawnOwnedChild)({
      role, instanceId: options.instanceId, cwd: options.root, port: config.port, env, log,
      command: { file: process.execPath, args: [...(options.bundled ? [] : ['--import', 'tsx']),
        join(options.root, `apps/${role === 'server' ? 'server/index' : 'host/inject'}.${options.bundled ? 'mjs' : 'ts'}`), ...args] },
    });
    children.push({ role, child });
    // If the server dies while the injector starts, stop startup immediately.
    const previousExit = children.slice(0, -1).map(({ role: previousRole, child: previous }) =>
      previous.exited.then(() => { throw new Error(`${previousRole} stopped while starting ${role}.`); }));
    await Promise.race([child.waitReady(readyTimeout, startupSignal), ...previousExit]);
  };
  try {
    await start('server', []);
    log('launcher', `Service ready: http://127.0.0.1:${config.port}\n`);
    if (config.mode === 'embed') {
      await start('injector', ['--port', String(config.cdpPort), '--taskboard-url', `http://127.0.0.1:${config.port}`,
        ...(config.launchHost ? [] : ['--no-launch'])]);
      log('launcher', 'Injector is watching Codex. Panel loading is verified separately when you open it.\n');
    }
    if (signal.aborted) return;
    options.onRunning();
    await Promise.race([requestedStop, ...children.map(({ role, child }) => child.exited.then((result) => {
      throw new Error(`${role} stopped unexpectedly (code=${result.code}, signal=${result.signal}). Check launcher logs.`);
    }))]);
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    // Cancel the losing readiness waiter when a previously started child exits.
    startup.abort();
    signal.removeEventListener('abort', stopListener);
    // A state/log write failure must not bypass owned-process cleanup.
    let cleanupError: unknown;
    try { options.onStopping(); } catch (error) { cleanupError = error; }
    for (const { role, child } of [...children].reverse()) {
      try {
        const result = await child.stop(options.stopTimeoutMs ?? (role === 'injector' ? 45_000 : 5000));
        if (result.signal === 'SIGKILL') {
          log('launcher', `${role} required forced shutdown; graceful cleanup could not be confirmed.\n`);
          cleanupError ??= new Error(`${role} did not shut down gracefully.`);
        } else if (result.error || (result.code !== null && result.code !== 0)) {
          cleanupError ??= new Error(`${role} exited with an error; cleanup could not be confirmed. Check launcher logs.`);
        }
      } catch (error) { cleanupError ??= error; }
    }
    if (cleanupError) throw cleanupError;
  }
}
