// Codex (ChatGPT.app) embedding: launch an independent Codex instance with a loopback-only CDP port,
// then inject a native-looking Taskboard sidebar entry and panel into its renderer. The official app bundle is never modified.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCdpReachable } from './cdp.ts';
import { buildCodexPanelControllerSource } from './panel.ts';

export const defaultCodexAppPath = '/Applications/ChatGPT.app';
export const defaultCodexCdpPort = 9231;
export const defaultTaskboardUrl = 'http://127.0.0.1:47830';
export const codexEmbedMarker = '__taskmanagerCodexEmbed';

export function isCodexHostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === '-' && !url.username && !url.password
      && !['/global-dictation', '/avatar-overlay'].includes(url.searchParams.get('initialRoute') ?? '');
  } catch { return false; }
}

/** The panel iframe may only load the local Taskboard instance; a non-loopback URL is rejected before injection. */
export function assertLocalTaskboardUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Taskboard URL must be a local http URL without credentials');
  }
  return url.origin;
}

export function codexProfileDirectory(): string {
  return join(homedir(), 'Library', 'Application Support', 'TaskManager', 'codex-profile');
}

export function codexLaunchArguments(port: number, profileDir: string): string[] {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CDP port must be an integer between 1024 and 65535');
  return [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
  ];
}

/** Starts a new Codex instance on its own profile; returns once the CDP endpoint answers or after the timeout. */
export async function launchCodex(options: { port: number; profileDir: string; appPath?: string; timeoutMs?: number }): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Codex embedding is currently supported on macOS only');
  const appPath = options.appPath ?? defaultCodexAppPath;
  const child = spawn('open', ['-n', '-a', appPath, '--args', ...codexLaunchArguments(options.port, options.profileDir)], { stdio: 'ignore', detached: true });
  let launchError: Error | undefined;
  child.once('error', (error) => { launchError = error; });
  child.once('exit', (code) => { if (code !== 0) launchError = new Error(`Unable to launch Codex (open exited with ${code})`); });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (await isCdpReachable(options.port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Codex did not expose CDP on port ${options.port} within the timeout`);
}

/**
 * Idempotent injection. The entry is placed next to Codex's own "Plugins" sidebar item (classic sidebar) or as the last
 * item of the compact navigation rail, cloned so it inherits the native classes. When neither anchor exists the script
 * falls back to a floating button, so the panel stays reachable while Codex's layout changes.
 */
export function buildCodexInjectionScript(taskboardUrl: string): string {
  const origin = assertLocalTaskboardUrl(taskboardUrl);
  const config = JSON.stringify({ origin, marker: codexEmbedMarker, labels: { zh: '任务面板', en: 'Taskboard' } });
  return `(() => {
  const hostUrl = new URL(window.location.href);
  if (hostUrl.protocol !== 'app:' || hostUrl.hostname !== '-' || hostUrl.username || hostUrl.password || ['/global-dictation', '/avatar-overlay'].includes(hostUrl.searchParams.get('initialRoute'))) return 'unsupported-host';
  const config = ${config};
  if (window[config.marker]?.version === 'opaque-host-v2') return 'already-injected';
  window[config.marker]?.remove?.();
  const OWNED = 'data-taskmanager-owned';
  const ENTRY_ID = 'taskmanager-codex-entry';
  const PLUGIN_LABELS = ['插件', 'plugins'];
  const label = () => (navigator.language || '').toLowerCase().startsWith('zh') ? config.labels.zh : config.labels.en;
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  let entry = null;
  let entryInRail = null;
  let fallback = null;
  let frame = null;
  let disposed = false;
  let started = false;
  let observer = null;
  const panel = ${buildCodexPanelControllerSource()}(label, sync, () => (entry || fallback)?.focus());

  function findAnchor() {
    const rail = document.querySelector('nav[data-app-navigation-rail]');
    if (rail) {
      const buttons = Array.from(rail.querySelectorAll('button')).filter((button) => button.getAttribute(OWNED) !== 'true');
      if (buttons.length) return { anchor: buttons[buttons.length - 1], inRail: true };
    }
    const scroll = document.querySelector('[data-app-action-sidebar-scroll]');
    if (scroll) {
      const plugin = Array.from(scroll.querySelectorAll('button')).find((button) => button.getAttribute(OWNED) !== 'true' && PLUGIN_LABELS.includes(normalize(button.textContent)));
      if (plugin) return { anchor: plugin, inRail: false };
    }
    return null;
  }

  function buildIcon(source) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const className = source?.getAttribute('class');
    if (className) icon.setAttribute('class', className);
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>';
    return icon;
  }

  function buildEntry(anchor, inRail) {
    const button = document.createElement('button');
    button.id = ENTRY_ID;
    button.type = 'button';
    button.setAttribute(OWNED, 'true');
    for (const attribute of Array.from(anchor.attributes)) {
      if (attribute.name === 'class' || attribute.name === 'style') button.setAttribute(attribute.name, attribute.value);
    }
    const text = document.createElement('span');
    text.textContent = label();
    if (inRail) text.className = 'sr-only';
    button.append(buildIcon(anchor.querySelector('svg')), text);
    button.setAttribute('aria-label', label());
    button.title = label();
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.setOpen(!panel.isOpen());
    });
    return button;
  }

  function mountFallback() {
    if (fallback) { if (!fallback.isConnected) document.body.append(fallback); return; }
    fallback = document.createElement('button');
    fallback.id = ENTRY_ID;
    fallback.type = 'button';
    fallback.setAttribute(OWNED, 'true');
    fallback.textContent = label();
    fallback.setAttribute('aria-label', label());
    fallback.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:6px 12px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#1d2939;font:13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.12)';
    fallback.addEventListener('click', () => panel.setOpen(!panel.isOpen()));
    document.body.append(fallback);
  }

  function sync() {
    if (disposed || !document.body) return;
    const found = findAnchor();
    if (!found) {
      if (entry) { entry.remove(); entry = null; entryInRail = null; }
      mountFallback();
    } else {
      if (fallback) { fallback.remove(); fallback = null; }
      if (entry && entryInRail !== found.inRail) { entry.remove(); entry = null; }
      if (!entry) { entry = buildEntry(found.anchor, found.inRail); entryInRail = found.inRail; }
      if (entry.previousElementSibling !== found.anchor) found.anchor.after(entry);
    }
    const selected = panel.isOpen();
    if (entry) {
      entry.toggleAttribute('data-selected', selected);
      entry.setAttribute('aria-expanded', String(selected));
      if (selected) entry.setAttribute('aria-current', 'page');
      else entry.removeAttribute('aria-current');
    }
    if (fallback) fallback.setAttribute('aria-expanded', String(selected));
    panel.sync();
  }

  // Codex re-renders its sidebar often; coalesce mutations into one sync per frame.
  function schedule() {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; sync(); });
  }

  const onResize = () => panel.place();
  const onKey = (event) => { if (event.key === 'Escape' && panel.isOpen() && !event.defaultPrevented) { event.preventDefault(); panel.setOpen(false); } };

  function start() {
    if (disposed || started || !document.body) return;
    started = true;
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    sync();
  }

  window[config.marker] = {
      version: 'opaque-host-v2',
      status: panel.status,
      documentFailed: panel.documentFailed,
      remove() {
        disposed = true;
        document.removeEventListener('DOMContentLoaded', start);
        if (frame !== null) cancelAnimationFrame(frame);
        observer?.disconnect();
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKey);
        entry?.remove();
        fallback?.remove();
        panel.remove();
        delete window[config.marker];
      },
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  return 'injected';
})()`;
}

/** Removes the entry and panel and clears the marker so a later injection starts clean. */
export function buildCodexRemovalScript(): string {
  return `(() => { const embed = window[${JSON.stringify(codexEmbedMarker)}]; if (embed) embed.remove(); return 'removed'; })()`;
}
