import { spawn } from 'node:child_process';
import type { LauncherReady } from '../../packages/contracts/desktop.ts';

export interface ChildResult { code: number | null; signal: NodeJS.Signals | null; error?: Error }
export interface OwnedChild {
  exited: Promise<ChildResult>;
  waitReady(timeoutMs: number, signal: AbortSignal): Promise<void>;
  stop(timeoutMs: number): Promise<ChildResult>;
}
export interface ChildOptions {
  role: LauncherReady['role']; instanceId: string; port: number; cwd: string;
  command: { file: string; args: string[] }; env: NodeJS.ProcessEnv;
  log: (source: string, chunk: Buffer | string) => void;
}

/** Own a direct Node child, never a PID discovered from a port or state file. */
export function spawnOwnedChild(options: ChildOptions): OwnedChild {
  const child = spawn(options.command.file, options.command.args, {
    cwd: options.cwd, env: { ...options.env, TASKMANAGER_LAUNCHER_ID: options.instanceId },
    // Keep terminal Ctrl+C on the supervisor, which tears down the injector first.
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let result: ChildResult | undefined;
  let settleExit!: (result: ChildResult) => void;
  let settleReady!: (error?: Error) => void;
  let ready = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise<ChildResult>((resolve) => { settleExit = resolve; });
  // This promise never rejects before the caller has installed its waiter.
  const readiness = new Promise<Error | undefined>((resolve) => { settleReady = resolve; });
  const finish = (value: ChildResult) => {
    if (result) return;
    clearTimeout(drainTimer);
    result = value;
    settleReady(value.error ?? new Error(`${options.role} exited before it was ready (code=${value.code}, signal=${value.signal}).`));
    settleExit(value);
  };
  child.stdout?.on('data', (chunk: Buffer) => options.log(`${options.role}-out`, chunk));
  child.stderr?.on('data', (chunk: Buffer) => options.log(`${options.role}-err`, chunk));
  child.once('error', (error) => finish({ code: null, signal: null, error }));
  child.once('close', (code, signal) => finish({ code, signal }));
  child.once('exit', (code, signal) => {
    if (result) return;
    // Normally close follows immediately. A descendant may retain the output
    // pipe, but that must not keep a confirmed-dead direct child alive here.
    drainTimer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (child.connected) child.disconnect();
      finish({ code, signal });
    }, 250);
  });
  child.on('message', (message: unknown) => {
    const value = message as Partial<LauncherReady> | null;
    if (value?.type !== 'taskmanager:ready' || value.instanceId !== options.instanceId || value.role !== options.role ||
        (options.role === 'server' && value.port !== options.port)) return;
    ready = true;
    settleReady();
  });

  return {
    exited,
    async waitReady(timeoutMs, signal) {
      if (signal.aborted) throw new Error('Launcher startup cancelled.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort = () => {};
      try {
        const error = await Promise.race([
          readiness,
          new Promise<Error>((resolve) => {
            timer = setTimeout(() => resolve(new Error(`${options.role} did not become ready in time.`)), timeoutMs);
            onAbort = () => resolve(new Error('Launcher startup cancelled.'));
            signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
        if (error) throw error;
        if (result || !ready) throw new Error(`${options.role} is no longer running.`);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
    async stop(timeoutMs) {
      if (result) return result;
      // child.kill checks the known handle's exit status; no process-group or PID-file kill.
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (!result) child.kill('SIGKILL'); }, timeoutMs);
      try { return await exited; } finally { clearTimeout(force); }
    },
  };
}
