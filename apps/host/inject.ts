// `npm run embed` — keep the Taskboard entry injected until interrupted.
// --once checks entry installation and then removes it; interactive panels need the resident loader.
import { pathToFileURL } from 'node:url';
import { isCdpReachable } from './cdp.ts';
import { CodexInjector, requireInjectionSuccess } from './injection.ts';
import { assertTaskboardReady } from './preflight.ts';
import { createEmbedDocumentSource } from './document.ts';
import { createInjectorLifecycle } from './lifecycle.ts';
import { assertLocalTaskboardUrl, codexProfileDirectory, defaultCodexCdpPort, defaultTaskboardUrl, launchCodex } from './codex.ts';

export interface InjectOptions { port: number; taskboardUrl: string; launch: boolean; once: boolean }

export function parseInjectOptions(argv: string[], defaultUrl = process.env.TASKMANAGER_URL ?? defaultTaskboardUrl): InjectOptions {
  const options: InjectOptions = { port: defaultCodexCdpPort, taskboardUrl: defaultUrl, launch: true, once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--port' || argument === '--taskboard-url') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      if (argument === '--port') options.port = Number(value);
      else options.taskboardUrl = value;
    } else if (argument === '--no-launch') options.launch = false;
    else if (argument === '--once') options.once = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('--port must be an integer between 1024 and 65535');
  options.taskboardUrl = assertLocalTaskboardUrl(options.taskboardUrl);
  return options;
}

async function main(): Promise<void> {
  const options = parseInjectOptions(process.argv.slice(2));
  const accessToken = process.env.TASKMANAGER_ACCESS_TOKEN;
  const pageId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lifecycle = createInjectorLifecycle({
    process, instanceId: process.env.TASKMANAGER_LAUNCHER_ID,
    cancelPending: () => clearTimeout(timer),
    onError: (error) => { console.error((error as Error).message); process.exitCode = 1; },
  });
  try {
    await lifecycle.start(async () => {
      await assertTaskboardReady(options.taskboardUrl, fetch, accessToken);
      if (lifecycle.stopped) return;
      const documents = await createEmbedDocumentSource(options.taskboardUrl, { accessToken });
      lifecycle.own(() => documents.close());
      if (lifecycle.stopped) return;
      const injector = new CodexInjector({ ...options, documents, onDiagnostic: (target, message) => console.warn(`[Taskboard page=${pageId(target.id)}] ${message}`) });
      lifecycle.own(() => injector.stop());
      const sync = async () => {
        const report = await injector.sync();
        for (const target of report.injected) console.log(`Injected Taskboard entry [page=${pageId(target.id)}]; panel loading is not yet verified.`);
        for (const error of report.errors) console.warn(`Skipped ${error}`);
        return report;
      };
      const reachable = await isCdpReachable(options.port);
      if (lifecycle.stopped) return;
      if (!reachable) {
        if (!options.launch) throw new Error(`No CDP endpoint on port ${options.port} and --no-launch was given`);
        console.log(`Launching Codex with CDP on 127.0.0.1:${options.port}`);
        await launchCodex({ port: options.port, profileDir: codexProfileDirectory() });
      }
      if (lifecycle.stopped) return;
      console.log('Using an isolated Taskboard frame; CSP bypass applies to the connected test pages until cleanup.');
      const initial = await sync();
      if (lifecycle.stopped) return;
      if (options.once) { requireInjectionSuccess(initial); return; }
      if (!initial.active) console.log('No injectable page yet; waiting for Codex to open a page.');
      console.log('Keeping the Taskboard entry injected. Press Ctrl+C to remove it and exit.');
      const poll = async () => {
        if (lifecycle.stopped) return;
        try { await sync(); }
        catch (error) { if (!lifecycle.stopped) console.warn((error as Error).message); }
        if (!lifecycle.stopped) timer = setTimeout(() => { void poll(); }, 2000);
      };
      timer = setTimeout(() => { void poll(); }, 2000);
    });
    if (lifecycle.stopped) { await lifecycle.stop(); return; }
    if (options.once) {
      await lifecycle.stop();
      if (!process.exitCode) console.log('Entry installation checked and removed. Omit --once to load and use the panel.');
      return;
    }
    // This acknowledges the resident watcher only; the iframe reports its own ready state later.
    lifecycle.notifyReady();
  } catch (error) { await lifecycle.stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
}
