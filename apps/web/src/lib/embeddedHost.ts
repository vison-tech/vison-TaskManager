import { useSyncExternalStore } from 'react';
import { embeddedHostSnapshot, type EmbeddedHostAction, type EmbeddedHostClient, type EmbeddedHostSnapshot } from '../../../../packages/contracts/embeddedHost.ts';
import { readEmbeddedConfig } from './embedded';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class EmbeddedHostError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EmbeddedHostError'; }
}

/** Uses only the authenticated channel for this frame; it exposes no arbitrary host calls. */
export function createEmbeddedHostClient(surface: Window, timeoutMs = 6000): (EmbeddedHostClient & { dispose(): void }) | null {
  const config = readEmbeddedConfig(surface);
  if (!config) return null;
  let challenge = '', parentOrigin: string | undefined, disposed = false;
  let snapshot: EmbeddedHostSnapshot | null = null;
  const subscribers = new Set<() => void>();
  const pending = new Map<string, Pending>();
  const update = (next: EmbeddedHostSnapshot | null) => {
    snapshot = next;
    for (const listener of subscribers) listener();
  };
  const cancel = (code: string, message: string) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new EmbeddedHostError(code, message)); }
    pending.clear();
  };
  const receive = (event: MessageEvent) => {
    const value = event.data;
    if (disposed || event.source !== surface.parent || !value || typeof value !== 'object' || value.capability !== config.capability) return;
    if (value.type === 'taskmanager:challenge') {
      if (typeof value.challenge !== 'string' || !uuid.test(value.challenge)) return;
      if (value.challenge !== challenge) {
        cancel('HOST_RELOADED', '宿主面板已重新加载，请重试。');
        challenge = value.challenge;
        parentOrigin = event.origin;
        update(null);
      }
      return;
    }
    if (!challenge || value.challenge !== challenge || event.origin !== parentOrigin) return;
    if (value.type === 'taskmanager:host-context') {
      const parsed = embeddedHostSnapshot.safeParse(value.payload);
      if (parsed.success) update(parsed.data);
      return;
    }
    if (value.type !== 'taskmanager:host-response' || typeof value.requestId !== 'string') return;
    const item = pending.get(value.requestId);
    if (!item) return;
    pending.delete(value.requestId); clearTimeout(item.timer);
    if (value.ok === true) item.resolve(value.payload);
    else item.reject(new EmbeddedHostError(
      typeof value.error?.code === 'string' ? value.error.code.slice(0, 80) : 'HOST_ERROR',
      typeof value.error?.message === 'string' ? value.error.message.slice(0, 300) : '宿主操作失败，请重试。',
    ));
  };
  surface.addEventListener('message', receive);

  const request = (action: EmbeddedHostAction, payload: unknown): Promise<unknown> => {
    if (disposed || !challenge) return Promise.reject(new EmbeddedHostError('HOST_UNAVAILABLE', '尚未连接 Codex，请重新打开任务面板。'));
    if (pending.size >= 8) return Promise.reject(new EmbeddedHostError('HOST_BUSY', '宿主正在处理请求，请稍后重试。'));
    const requestId = surface.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId); update(null);
        reject(new EmbeddedHostError('HOST_TIMEOUT', 'Codex 未及时响应，请刷新宿主信息后重试。'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        surface.parent.postMessage({ type: 'taskmanager:host-request', capability: config.capability, challenge, requestId, action, payload }, parentOrigin === 'null' ? '*' : parentOrigin!);
      } catch {
        clearTimeout(timer); pending.delete(requestId);
        reject(new EmbeddedHostError('HOST_UNAVAILABLE', '无法联系 Codex，请重新打开任务面板。'));
      }
    });
  };
  const requireCapability = (name: 'openConversation' | 'composeDraft') => {
    const capability = snapshot?.capabilities[name];
    if (capability?.state !== 'supported') throw new EmbeddedHostError('HOST_UNAVAILABLE', capability?.reason ?? '当前宿主未提供此功能。');
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    async refresh() {
      const parsed = embeddedHostSnapshot.safeParse(await request('context', {}));
      if (!parsed.success) { update(null); throw new EmbeddedHostError('HOST_PROTOCOL_ERROR', 'Codex 返回的上下文无法识别。'); }
      update(parsed.data); return parsed.data;
    },
    async openConversation(session) { requireCapability('openConversation'); return request('openConversation', session); },
    async composeDraft(draft) { requireCapability('composeDraft'); return request('composeDraft', draft); },
    dispose() {
      disposed = true; surface.removeEventListener('message', receive);
      cancel('HOST_DISCONNECTED', '宿主连接已关闭。'); update(null); subscribers.clear();
    },
  };
}

export const embeddedHost = typeof window === 'undefined' ? null : createEmbeddedHostClient(window);
const emptySnapshot = () => null;
const noopSubscribe = () => () => {};
export function useEmbeddedHost(client: EmbeddedHostClient | null = embeddedHost): EmbeddedHostSnapshot | null {
  return useSyncExternalStore(client?.subscribe ?? noopSubscribe, client?.getSnapshot ?? emptySnapshot, emptySnapshot);
}
