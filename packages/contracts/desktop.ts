/** Local launcher state contains no credentials. Runtime secrets remain in inherited environment only. */
export interface LauncherConfig {
  version: 1;
  dataDir: string;
  port: number;
  cdpPort: number;
  mode: 'embed' | 'web';
  launchHost: boolean;
}
export interface LauncherState {
  version: 1;
  instanceId: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  phase: 'starting' | 'running' | 'stopping' | 'failed';
  port: number;
  mode: LauncherConfig['mode'];
}

/** Private IPC acknowledgement from a process spawned by the current launcher. */
export interface LauncherReady {
  type: 'taskmanager:ready';
  instanceId: string;
  role: 'server' | 'injector';
  port?: number;
}
