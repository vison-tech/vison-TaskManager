// `npm run embed` — start (or reuse) a Codex instance and keep the Taskboard entry injected into its pages.
// Usage: npm run embed -- [--port 9231] [--taskboard-url http://127.0.0.1:47830] [--no-launch] [--once]
import { CdpConnection, isCdpReachable, listCdpTargets, type CdpTarget } from './cdp.ts';
import {
  buildCodexInjectionScript,
  buildCodexRemovalScript,
  assertLocalTaskboardUrl,
  codexProfileDirectory,
  defaultCodexCdpPort,
  defaultTaskboardUrl,
  launchCodex,
} from './codex.ts';

interface InjectOptions { port: number; taskboardUrl: string; launch: boolean; once: boolean }

function parseOptions(argv: string[]): InjectOptions {
  const options: InjectOptions = { port: defaultCodexCdpPort, taskboardUrl: process.env.TASKMANAGER_URL ?? defaultTaskboardUrl, launch: true, once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--taskboard-url') options.taskboardUrl = argv[++index] ?? options.taskboardUrl;
    else if (argument === '--no-launch') options.launch = false;
    else if (argument === '--once') options.once = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('--port must be an integer between 1024 and 65535');
  assertLocalTaskboardUrl(options.taskboardUrl);
  return options;
}

// Codex pages are the renderer targets; devtools and service-worker targets are never injected.
function isInjectableTarget(target: CdpTarget): boolean {
  return target.type === 'page' && !target.url.startsWith('devtools://');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const taskboardOrigin = assertLocalTaskboardUrl(options.taskboardUrl);
  const meta = await fetch(`${taskboardOrigin}/api/v1/meta`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!meta?.ok) throw new Error(`Taskboard is not reachable at ${taskboardOrigin}; start it with npm start first`);

  if (!(await isCdpReachable(options.port))) {
    if (!options.launch) throw new Error(`No CDP endpoint on port ${options.port} and --no-launch was given`);
    console.log(`Launching Codex with CDP on 127.0.0.1:${options.port}`);
    await launchCodex({ port: options.port, profileDir: codexProfileDirectory() });
  }

  const script = buildCodexInjectionScript(taskboardOrigin);
  // Each injected target keeps one CDP session open: Page.addScriptToEvaluateOnNewDocument only lasts for the session,
  // and keeping it means a renderer reload re-mounts the entry without a new poll cycle.
  const sessions = new Map<string, CdpConnection>();

  async function injectTarget(target: CdpTarget): Promise<void> {
    if (sessions.has(target.id)) return;
    const connection = await CdpConnection.open(target.webSocketDebuggerUrl);
    sessions.set(target.id, connection);
    await connection.send('Page.enable');
    await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: script });
    await connection.send('Runtime.evaluate', { expression: script, returnByValue: true });
    console.log(`Injected Taskboard entry into ${target.title || target.url}`);
  }

  async function sync(): Promise<void> {
    const targets = await listCdpTargets(options.port);
    const live = new Set(targets.filter(isInjectableTarget).map((target) => target.id));
    for (const target of targets.filter(isInjectableTarget)) {
      await injectTarget(target).catch((error: unknown) => console.warn(`Skipped ${target.id}: ${(error as Error).message}`));
    }
    for (const [id, connection] of sessions) {
      if (live.has(id)) continue;
      connection.close();
      sessions.delete(id);
    }
  }

  await sync();
  if (options.once) {
    for (const connection of sessions.values()) connection.close();
    return;
  }

  console.log('Keeping the Taskboard entry injected. Press Ctrl+C to remove it and exit.');
  const timer = setInterval(() => { void sync().catch((error: unknown) => console.warn((error as Error).message)); }, 2000);
  const shutdown = async () => {
    clearInterval(timer);
    const targets = await listCdpTargets(options.port).catch(() => []);
    for (const target of targets.filter(isInjectableTarget)) {
      const existing = sessions.get(target.id);
      const connection = existing ?? await CdpConnection.open(target.webSocketDebuggerUrl).catch(() => null);
      if (!connection) continue;
      await connection.send('Runtime.evaluate', { expression: buildCodexRemovalScript(), returnByValue: true }).catch(() => undefined);
      if (!existing) connection.close();
    }
    for (const connection of sessions.values()) connection.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
