import { hostCapabilities, hostBridgeMessage } from '../../packages/contracts/index.ts';
import type { HostCapabilities } from '../../packages/contracts/index.ts';

export type BridgeMessageEvent = { origin: string; source: unknown; data: unknown };
export interface BridgeChannel { addEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void; postMessage(message: unknown, targetOrigin: string): void; }
export type HostBridgeOptions = { channel: BridgeChannel; expectedOrigin: string; expectedSource?: unknown; capabilities?: HostCapabilities; handshakeToken?: string; authorize?: (payload: unknown) => boolean; timeoutMs?: number; onContext?: (payload: unknown) => void };

export class HostBridgeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'HostBridgeError'; }
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> };

export class HostBridge {
  private readonly channel: BridgeChannel;
  private readonly expectedOrigin: string;
  private readonly expectedSource?: unknown;
  private readonly handshakeToken?: string;
  private readonly authorize?: (payload: unknown) => boolean;
  private readonly timeoutMs: number;
  private readonly onContext?: (payload: unknown) => void;
  private readonly pending = new Map<string, Pending>();
  private capabilities: HostCapabilities | null = null;
  private started = false;
  private readonly listener = (event: BridgeMessageEvent) => this.receive(event);

  constructor(options: HostBridgeOptions) {
    this.channel = options.channel;
    this.expectedOrigin = options.expectedOrigin;
    this.expectedSource = options.expectedSource;
    this.handshakeToken = options.handshakeToken;
    this.authorize = options.authorize;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.capabilities = options.capabilities ?? null;
    this.onContext = options.onContext;
  }

  start(): void { if (this.started) return; this.started = true; this.channel.addEventListener('message', this.listener); }
  unload(): void { if (this.started) this.channel.removeEventListener('message', this.listener); this.started = false; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new HostBridgeError('BRIDGE_UNLOADED', 'Host bridge was unloaded')); } this.pending.clear(); }
  setCapabilities(value: HostCapabilities): void { this.capabilities = hostCapabilities.parse(value); }
  getCapabilities(): HostCapabilities | null { return this.capabilities; }

  hello(): Promise<unknown> { return this.request('hello', { token: this.handshakeToken }); }
  context(): Promise<unknown> { return this.request('context', {}); }
  openConversation(payload: unknown): Promise<unknown> { return this.request('openConversation', payload, 'openConversation'); }
  composeDraft(payload: unknown): Promise<unknown> { return this.request('composeDraft', payload, 'composeDraft'); }

  request(type: 'hello' | 'context' | 'openConversation' | 'composeDraft', payload: unknown, capability?: keyof HostCapabilities): Promise<unknown> {
    if (capability) {
      const state = this.capabilities?.[capability]?.state;
      if (state !== 'supported') throw new HostBridgeError(state === 'unavailable' ? 'HOST_UNAVAILABLE' : 'HOST_UNSUPPORTED', `Host capability ${capability} is ${state ?? 'unknown'}`);
    }
    const requestId = crypto.randomUUID();
    const message = hostBridgeMessage.parse({ protocolVersion: '1', requestId, type, payload });
    this.channel.postMessage(message, this.expectedOrigin);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new HostBridgeError('BRIDGE_TIMEOUT', `Host did not respond to ${type}`)); }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  private receive(event: BridgeMessageEvent): void {
    if (event.origin !== this.expectedOrigin || (this.expectedSource !== undefined && event.source !== this.expectedSource)) return;
    const parsed = hostBridgeMessage.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'hello') {
      const accepted = this.authorize ? this.authorize(message.payload) : true;
      this.channel.postMessage(hostBridgeMessage.parse({ protocolVersion: '1', requestId: message.requestId, type: accepted ? 'response' : 'error', payload: accepted ? { accepted: true } : 'Host authorization failed' }), this.expectedOrigin);
      if (accepted && this.capabilities) this.channel.postMessage(hostBridgeMessage.parse({ protocolVersion: '1', requestId: crypto.randomUUID(), type: 'capabilities', payload: this.capabilities }), this.expectedOrigin);
      return;
    }
    if (message.type === 'capabilities') {
      const parsedCapabilities = hostCapabilities.safeParse(message.payload);
      if (parsedCapabilities.success) this.capabilities = parsedCapabilities.data;
      return;
    }
    if (message.type === 'context') { this.onContext?.(message.payload); return; }
    if (message.type === 'response' || message.type === 'error') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId); clearTimeout(pending.timer);
      if (message.type === 'error') pending.reject(new HostBridgeError('HOST_ERROR', typeof message.payload === 'string' ? message.payload : 'Host request failed'));
      else pending.resolve(message.payload);
    }
  }
}
