import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { windowsRuntimeEnvironment } from './windows-runtime.ts';

const execute = promisify(execFile);
const entries = new Set(['desktop/index', 'desktop/gui', 'desktop/windows', 'desktop/selfcheck', 'server/index', 'host/inject']
  .map((name) => `app/apps/${name}.mjs`));

export async function assertWindowsPackageContents(payload: string): Promise<void> {
  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const stat = await lstat(path);
      const file = relative(payload, path).replaceAll('\\', '/');
      if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${file}`);
      if (stat.isDirectory()) { await visit(path); continue; }
      const allowed = entries.has(file) || ['TaskManager.cmd', 'TaskManager.ico', '使用说明.txt', 'user-guide.md', 'app/build-info.json', 'runtime/node.exe'].includes(file)
        || file.startsWith('licenses/') || file.startsWith('app/dist/web/');
      if (!allowed || /(?:^|\/)(?:\.env(?:\..*)?|launcher\.json|state\.json|node_modules)(?:\/|$)|\.sqlite(?:-wal|-shm)?$|\.map$/.test(file)) {
        throw new Error(`Unexpected release file: ${file}`);
      }
    }
  }
  await visit(payload);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

/** Actual HTTP start/stop plus offline persistence, with bundled Node and an empty tool PATH. */
export async function verifyWindowsPackage(payload: string, scratch: string): Promise<Record<string, unknown>> {
  const temporary = await mkdtemp(join(scratch, 'relocated 中文 '));
  try {
    const moved = join(temporary, 'TaskManager app');
    await cp(payload, moved, { recursive: true });
    const executable = join(moved, 'runtime/node.exe');
    const entry = join(moved, 'app/apps/desktop/windows.mjs');
    const env = { ...windowsRuntimeEnvironment(), TEMP: temporary, TMP: temporary,
      TASKMANAGER_HOME: join(temporary, 'persistent data'), TASKMANAGER_NO_BROWSER: '1' };
    const options = { env, cwd: temporary, timeout: 65_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true };
    const { stdout } = await execute(executable, [join(moved, 'app/apps/desktop/selfcheck.mjs')], options);
    const check = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(check.ok, true);
    assert.equal(check.persistence, true);
    await execute(executable, [entry, '--help'], options);
    const port = await freePort();
    const child = spawn(executable, [entry, '--port', String(port)], { env, cwd: temporary, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (value: Buffer) => { output += value; });
    child.stderr.on('data', (value: Buffer) => { output += value; });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Launcher test timed out: ${output}`)), 60_000); });
    // Observe spawn failures immediately, even before the exit assertion below.
    exited.catch(() => undefined);
    try {
      await Promise.race([timeout, (async () => {
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          if (child.exitCode !== null) throw new Error(`Launcher exited early: ${output}`);
          try {
            const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
            await response.arrayBuffer();
            if (response.status === 200) { ready = true; break; }
          } catch { /* Readiness can lag process creation. */ }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(ready, `Packaged service did not start: ${output}`);
        // Stop via the same .cmd entry used by the installer and shortcuts.
        await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'),
          ['/d', '/s', '/c', `""${join(moved, 'TaskManager.cmd')}" stop"`], { ...options, windowsVerbatimArguments: true });
        assert.equal(await exited, 0, output);
        let listening = false;
        try { const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); await res.arrayBuffer(); listening = true; } catch { /* Expected closed port. */ }
        assert.equal(listening, false, 'Stopping the launcher must close its server');
        const saved = JSON.parse(await readFile(join(env.TASKMANAGER_HOME, 'config/launcher.json'), 'utf8'));
        assert.equal(saved.mode, 'web');
        assert.equal(saved.dataDir, join(env.TASKMANAGER_HOME, 'data'));
      })()]);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      await exited.catch(() => undefined);
    }
    return { ...check, relocated: true, realHttp: true, gracefulStop: true, pathsWithSpacesAndUnicode: true, systemNode: false, hostStarted: false };
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}
