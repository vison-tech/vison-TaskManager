import { embedConfigKey, embedProtocolVersion, type EmbedPageConfig } from '../../../../packages/contracts/embed.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function readEmbeddedConfig(surface: Window): EmbedPageConfig | null {
  if (surface.parent === surface) return null;
  const value = (surface as unknown as Record<string, unknown>)[embedConfigKey];
  if (!value || typeof value !== 'object') return null;
  const config = value as Partial<EmbedPageConfig>;
  if (config.protocolVersion !== embedProtocolVersion || typeof config.baseUrl !== 'string' || typeof config.capability !== 'string' || !uuid.test(config.capability)) return null;
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !/^\/_embed\/[a-f0-9]{64}\/?$/.test(url.pathname)) return null;
    return { protocolVersion: embedProtocolVersion, baseUrl: url.href.replace(/\/$/, ''), capability: config.capability };
  } catch { return null; }
}

export interface EmbeddedRuntime {
  readonly config: EmbedPageConfig;
  ready(): void;
  failed(): void;
  dispose(): void;
}

/** Bind readiness to both the parent window and this particular frame document. */
export function createEmbeddedRuntime(surface: Window): EmbeddedRuntime | null {
  const config = readEmbeddedConfig(surface);
  if (!config) return null;
  let challenge = '';
  let state: 'loading' | 'ready' | 'failed' = 'loading';
  let disposed = false;
  const publish = () => {
    if (disposed || !challenge || state === 'loading') return;
    surface.parent.postMessage({
      type: state === 'ready' ? 'taskmanager:ready' : 'taskmanager:error',
      capability: config.capability,
      challenge,
      ...(state === 'failed' ? { code: 'WEB_START_FAILED' } : {}),
    }, '*');
  };
  const receive = (event: MessageEvent) => {
    const message = event.data;
    if (event.source !== surface.parent || !message || typeof message !== 'object' || message.type !== 'taskmanager:challenge' || message.capability !== config.capability || typeof message.challenge !== 'string' || !uuid.test(message.challenge)) return;
    challenge = message.challenge;
    publish();
  };
  surface.addEventListener('message', receive);
  return {
    config,
    ready() { if (state !== 'failed') state = 'ready'; publish(); },
    failed() { state = 'failed'; publish(); },
    dispose() { disposed = true; surface.removeEventListener('message', receive); },
  };
}

// Importing this module through the API client installs the listener before App boot.
export const embeddedRuntime = typeof window === 'undefined' ? null : createEmbeddedRuntime(window);
export const webBaseUrl = embeddedRuntime?.config.baseUrl ?? '';
export const webApiUrl = (path: string): string => `${webBaseUrl}${path}`;

/** An embedded board must read actual data before the mounted App can announce ready. */
export async function prepareWebClient<T>(
  client: { bootstrapSession(): Promise<unknown>; snapshot(): Promise<T> },
  runtime: EmbeddedRuntime | null,
  seedSnapshot: (snapshot: T) => void,
): Promise<void> {
  if (!runtime) {
    try { await client.bootstrapSession(); } catch { /* Unprotected local instances do not need a session. */ }
    return;
  }
  try { seedSnapshot(await client.snapshot()); }
  catch (error) { runtime.failed(); throw error; }
}
