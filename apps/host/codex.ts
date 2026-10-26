// Codex (ChatGPT.app) embedding: launch an independent Codex instance with a loopback-only CDP port,
// then inject a native-looking Taskboard sidebar entry and panel into its renderer. The official app bundle is never modified.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCdpReachable } from './cdp.ts';

export const defaultCodexAppPath = '/Applications/ChatGPT.app';
export const defaultCodexCdpPort = 9231;
export const defaultTaskboardUrl = 'http://127.0.0.1:47830';
export const codexEmbedMarker = '__taskmanagerCodexEmbed';

/** The panel iframe may only load the local Taskboard instance; a non-loopback URL is rejected before injection. */
export function assertLocalTaskboardUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`Taskboard URL must be a local http URL: ${value}`);
  }
  return url.origin;
}

export function codexProfileDirectory(): string {
  return join(homedir(), 'Library', 'Application Support', 'TaskManager', 'codex-profile');
}

export function codexLaunchArguments(port: number, profileDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
  ];
}

/** Starts a new Codex instance on its own profile; returns once the CDP endpoint answers or after the timeout. */
export async function launchCodex(options: { port: number; profileDir: string; appPath?: string; timeoutMs?: number }): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Codex embedding is currently supported on macOS only');
  const appPath = options.appPath ?? defaultCodexAppPath;
  const child = spawn('open', ['-n', '-a', appPath, '--args', ...codexLaunchArguments(options.port, options.profileDir)], { stdio: 'ignore', detached: true });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
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
  const config = ${config};
  if (window[config.marker]) return 'already-injected';
  const OWNED = 'data-taskmanager-owned';
  const ENTRY_ID = 'taskmanager-codex-entry';
  const PANEL_ID = 'taskmanager-codex-panel';
  const PLUGIN_LABELS = ['插件', 'plugins'];
  const label = () => (navigator.language || '').toLowerCase().startsWith('zh') ? config.labels.zh : config.labels.en;
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  let entry = null;
  let entryInRail = null;
  let fallback = null;
  let panel = null;
  let open = false;
  let scheduled = false;
  let observer = null;

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
      if (['id', 'data-selected', 'aria-current', 'aria-label', 'title', 'aria-expanded'].includes(attribute.name)) continue;
      if (attribute.name.startsWith('data-app-action-sidebar')) continue;
      button.setAttribute(attribute.name, attribute.value);
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
      setOpen(!open);
    });
    return button;
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('iframe');
    panel.id = PANEL_ID;
    panel.title = label();
    panel.setAttribute('aria-label', label());
    panel.style.cssText = 'position:fixed;z-index:2147483645;border:0;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgba(0,0,0,.2);display:none';
    document.body.append(panel);
    return panel;
  }

  function placePanel() {
    const host = document.querySelector('.app-shell-main-content-frame');
    if (!host) {
      Object.assign(panel.style, { right: '16px', bottom: '16px', width: 'min(960px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 32px))', left: '', top: '' });
      return;
    }
    const rect = host.getBoundingClientRect();
    Object.assign(panel.style, { left: rect.left + 8 + 'px', top: rect.top + 8 + 'px', width: Math.max(0, rect.width - 16) + 'px', height: Math.max(0, rect.height - 16) + 'px', right: '', bottom: '' });
  }

  function setOpen(next) {
    open = next;
    const target = ensurePanel();
    if (open) {
      if (!target.src) target.src = config.origin + '/';
      placePanel();
      target.style.display = 'block';
    } else {
      target.style.display = 'none';
    }
    sync();
  }

  function mountFallback() {
    if (fallback) return;
    fallback = document.createElement('button');
    fallback.id = ENTRY_ID;
    fallback.type = 'button';
    fallback.setAttribute(OWNED, 'true');
    fallback.textContent = label();
    fallback.setAttribute('aria-label', label());
    fallback.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:6px 12px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#1d2939;font:13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.12)';
    fallback.addEventListener('click', () => setOpen(!open));
    document.body.append(fallback);
  }

  function sync() {
    scheduled = false;
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
    const selected = Boolean(open);
    if (entry) {
      entry.toggleAttribute('data-selected', selected);
      if (selected) entry.setAttribute('aria-current', 'page');
      else entry.removeAttribute('aria-current');
    }
    if (fallback) fallback.setAttribute('aria-expanded', String(open));
  }

  // Codex re-renders its sidebar often; coalesce mutations into one sync per frame.
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  }

  const onResize = () => { if (open) placePanel(); };
  const onKey = (event) => { if (event.key === 'Escape' && open) setOpen(false); };

  function start() {
    if (!document.body) return;
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window[config.marker] = {
      remove() {
        observer?.disconnect();
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKey);
        entry?.remove();
        fallback?.remove();
        panel?.remove();
        delete window[config.marker];
      },
    };
    sync();
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  return 'injected';
})()`;
}

/** Removes the entry and panel and clears the marker so a later injection starts clean. */
export function buildCodexRemovalScript(): string {
  return `(() => { const embed = window[${JSON.stringify(codexEmbedMarker)}]; if (embed) embed.remove(); return 'removed'; })()`;
}
