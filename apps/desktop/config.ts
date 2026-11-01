import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LauncherConfig } from '../../packages/contracts/desktop.ts';

type Overrides = Partial<Omit<LauncherConfig, 'version'>>;
type Command = 'start' | 'status' | 'stop' | 'logs' | 'help';
export interface LauncherArgs { command: Command; configDir?: string; overrides: Overrides }
const commands = new Set<Command>(['start', 'status', 'stop', 'logs', 'help']);
const configKeys = new Set(['version', 'dataDir', 'port', 'cdpPort', 'mode', 'launchHost']);

function absoluteDirectory(value: string): string {
  if (!value.trim() || value.includes('\0') || /[\r\n]/.test(value)) throw new Error('Directory must be a non-empty path.');
  return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}

function port(value: unknown, name: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) {
    throw new Error(`${name} must be an integer between 1024 and 65535.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error(`${name} must be an integer between 1024 and 65535.`);
  return parsed;
}

function validateConfig(value: unknown): LauncherConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid launcher configuration.');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !configKeys.has(key)) || item.version !== 1 ||
      typeof item.dataDir !== 'string' || !isAbsolute(item.dataDir) ||
      typeof item.launchHost !== 'boolean' || (item.mode !== 'embed' && item.mode !== 'web')) {
    throw new Error('Invalid launcher configuration; expected version 1 and supported settings only.');
  }
  const config: LauncherConfig = {
    version: 1, dataDir: absoluteDirectory(item.dataDir), port: port(item.port, 'Service port'),
    cdpPort: port(item.cdpPort, 'CDP port'), mode: item.mode, launchHost: item.launchHost,
  };
  if (config.mode === 'embed' && config.port === config.cdpPort) throw new Error('Service and CDP ports must be different in embed mode.');
  return config;
}

export function parseLauncherArgs(argv: string[]): LauncherArgs {
  const result: LauncherArgs = { command: 'start', overrides: {} };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    if (!commands.has(argv[0] as Command)) throw new Error('Unknown launcher command. Use --help.');
    result.command = argv[0] as Command;
    index = 1;
  }
  const seen = new Set<string>();
  for (; index < argv.length; index += 1) {
    const option = argv[index];
    const key = option === '--no-launch' || option === '--launch-host' ? 'launchHost' : option;
    if (seen.has(key)) throw new Error('Launcher options must not be repeated.');
    seen.add(key);
    if (option === '--help' || option === '-h') { result.command = 'help'; continue; }
    if (option === '--no-launch' || option === '--launch-host') { result.overrides.launchHost = option === '--launch-host'; continue; }
    if (!['--config-dir', '--data-dir', '--port', '--cdp-port', '--mode'].includes(option)) {
      throw new Error('Unknown launcher option. Use --help.');
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
    if (option === '--config-dir') result.configDir = absoluteDirectory(value);
    else if (option === '--data-dir') result.overrides.dataDir = absoluteDirectory(value);
    else if (option === '--port') result.overrides.port = port(value, '--port');
    else if (option === '--cdp-port') result.overrides.cdpPort = port(value, '--cdp-port');
    else {
      if (value !== 'embed' && value !== 'web') throw new Error('--mode must be embed or web.');
      result.overrides.mode = value;
    }
  }
  if (result.command !== 'start' && Object.keys(result.overrides).length) throw new Error('Launch settings are only accepted with start.');
  return result;
}

export function defaultLauncherDirectory(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'TaskManager');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'TaskManager');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'taskmanager');
}

export function resolveLauncherConfig(dir: string, overrides: Overrides, env: NodeJS.ProcessEnv = process.env): LauncherConfig {
  let saved: LauncherConfig | undefined;
  try {
    const raw = readFileSync(join(dir, 'launcher.json'), 'utf8');
    try { saved = validateConfig(JSON.parse(raw)); }
    catch { throw new Error('Cannot read launcher.json: invalid or unsupported configuration.'); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const dataDir = overrides.dataDir ?? saved?.dataDir ?? env.TASKMANAGER_DATA_DIR;
  if (!dataDir) throw new Error('First launch requires --data-dir <directory> (or TASKMANAGER_DATA_DIR). Choose your existing data directory to keep using the same tasks.');
  return validateConfig({
    version: 1, dataDir: absoluteDirectory(dataDir),
    port: overrides.port ?? saved?.port ?? env.PORT ?? 47830,
    cdpPort: overrides.cdpPort ?? saved?.cdpPort ?? 9231,
    mode: overrides.mode ?? saved?.mode ?? 'embed',
    launchHost: overrides.launchHost ?? saved?.launchHost ?? true,
  });
}

export function saveLauncherConfig(dir: string, config: LauncherConfig): void {
  const value = validateConfig(config);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.launcher-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, join(dir, 'launcher.json'));
  } finally { rmSync(temporary, { force: true }); }
}
