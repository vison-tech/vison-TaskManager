import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LauncherConfig, LauncherState } from '../../packages/contracts/desktop.ts';

export interface LauncherStatus {
  status: 'stopped' | 'active' | 'stale' | 'unknown';
  state?: LauncherState;
}

const stateKeys = ['version', 'instanceId', 'pid', 'startedAt', 'updatedAt', 'phase', 'port', 'mode'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;
const validDate = (value: unknown): value is string => typeof value === 'string'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function readJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid launcher state file');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readState(running: string): LauncherState | undefined {
  try {
    if (!lstatSync(running).isDirectory()) return;
    const value = readJson(join(running, 'state.json')) as Record<string, unknown> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== stateKeys.length || !stateKeys.every((key) => Object.hasOwn(value, key))
      || value.version !== 1 || typeof value.instanceId !== 'string' || !uuid.test(value.instanceId)
      || !Number.isInteger(value.pid) || (value.pid as number) < 2 || (value.pid as number) > 2147483647
      || !validDate(value.startedAt) || !validDate(value.updatedAt)
      || !['starting', 'running', 'stopping', 'failed'].includes(value.phase as string)
      || !Number.isInteger(value.port) || (value.port as number) < 1024 || (value.port as number) > 65535
      || !['embed', 'web'].includes(value.mode as string)) return;
    return value as unknown as LauncherState;
  } catch { return; }
}

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function readLauncherStatus(dir: string): LauncherStatus {
  const running = join(dir, 'running');
  try { lstatSync(running); }
  catch (error) { return { status: errorCode(error) === 'ENOENT' ? 'stopped' : 'unknown' }; }
  const state = readState(running);
  if (!state) return { status: 'unknown' };
  try {
    // Signal 0 only checks existence. Never use a saved PID to stop a process.
    process.kill(state.pid, 0);
    return { status: 'active', state };
  } catch (error) {
    return { status: errorCode(error) === 'ESRCH' ? 'stale' : errorCode(error) === 'EPERM' ? 'active' : 'unknown', state };
  }
}

export function requestLauncherStop(dir: string): LauncherStatus & { requested: boolean } {
  const status = readLauncherStatus(dir);
  if (status.status !== 'active' || !status.state) return { ...status, requested: false };
  const running = join(dir, 'running');
  const instanceId = status.state.instanceId;
  // A generation-specific name cannot overwrite a newer owner's stop request.
  const stopPath = join(running, `stop-${instanceId}.json`);
  try {
    if (readState(running)?.instanceId !== instanceId) return { ...readLauncherStatus(dir), requested: false };
    atomicJson(stopPath, { instanceId });
    if (readState(running)?.instanceId !== instanceId) return { ...readLauncherStatus(dir), requested: false };
    return { ...status, requested: true };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { ...readLauncherStatus(dir), requested: false };
    throw error;
  }
}

export function acquireLauncherLock(dir: string, config: LauncherConfig) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const running = join(dir, 'running');
  try { mkdirSync(running, { mode: 0o700 }); }
  catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    const current = readLauncherStatus(dir);
    if (current.status === 'active') throw new Error(`A TaskManager launcher already owns ${running}. Use the stop command first.`);
    throw new Error(`Launcher state is ${current.status}: ${running}. Check that the old launcher has exited, then remove only this running directory before retrying. No process was stopped.`);
  }
  const ownedDirectory = lstatSync(running);
  const now = new Date().toISOString();
  const state: LauncherState = {
    version: 1, instanceId: randomUUID(), pid: process.pid, startedAt: now, updatedAt: now,
    phase: 'starting', port: config.port, mode: config.mode,
  };
  let released = false;
  const sameDirectory = () => {
    try {
      const current = lstatSync(running);
      return current.isDirectory() && current.dev === ownedDirectory.dev && current.ino === ownedDirectory.ino;
    } catch { return false; }
  };
  const owns = () => !released && sameDirectory() && readState(running)?.instanceId === state.instanceId;
  try { atomicJson(join(running, 'state.json'), state); }
  catch (error) {
    if (sameDirectory()) rmSync(running, { recursive: true, force: true });
    throw error;
  }
  return {
    state,
    update(phase: LauncherState['phase']) {
      if (!owns()) throw new Error('Launcher ownership was lost; refusing to overwrite another instance.');
      state.phase = phase;
      state.updatedAt = new Date().toISOString();
      atomicJson(join(running, 'state.json'), state);
    },
    heartbeat() { this.update(state.phase); },
    stopRequested() {
      if (!owns()) throw new Error('Launcher ownership was lost.');
      try {
        const request = readJson(join(running, `stop-${state.instanceId}.json`)) as { instanceId?: unknown } | null;
        return request?.instanceId === state.instanceId;
      } catch { return false; }
    },
    release() {
      if (owns()) rmSync(running, { recursive: true, force: true });
      released = true;
    },
  };
}
