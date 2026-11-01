// Minimal loopback-only Chrome DevTools Protocol transport.
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
}

export function cdpHttpUrl(port: number, path: string): string {
  validatePort(port);
  return `http://127.0.0.1:${port}${path}`;
}

export function assertLoopbackCdpUrl(value: string, port: number): string {
  validatePort(port);
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port || url.username || url.password) {
    throw new Error('Refusing non-loopback or credential-bearing CDP endpoint');
  }
  return url.toString();
}

export async function isCdpReachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(cdpHttpUrl(port, '/json/version'), { signal: AbortSignal.timeout(1500), redirect: 'error' });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listCdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(cdpHttpUrl(port, '/json/list'), { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`CDP target list failed with HTTP ${response.status}`);
  const targets: unknown = await response.json();
  if (!Array.isArray(targets)) throw new Error('Invalid CDP target list');
  return targets.filter((target) => target && typeof target === 'object' && typeof target.webSocketDebuggerUrl === 'string').map((target) => {
    if (typeof target.id !== 'string' || typeof target.type !== 'string' || typeof target.url !== 'string') throw new Error('Invalid CDP target');
    return { ...target, title: typeof target.title === 'string' ? target.title : '', webSocketDebuggerUrl: assertLoopbackCdpUrl(target.webSocketDebuggerUrl, port) } as CdpTarget;
  });
}

type Socket = Pick<WebSocket, 'readyState' | 'addEventListener' | 'removeEventListener' | 'send' | 'close'>;
type ConnectionOptions = { timeoutMs?: number; createSocket?: (url: string) => Socket };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type EventListener = (method: string, params: Record<string, unknown>) => void;

export class CdpConnection {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<EventListener>();
  private constructor(private readonly socket: Socket, private readonly timeoutMs: number) {
    socket.addEventListener('message', (event) => {
      let message: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
      try { message = JSON.parse(String(event.data)); }
      catch { this.fail(new Error('Invalid CDP response')); this.socket.close(); return; }
      if (!message || typeof message !== 'object' || this.closed) return;
      if (typeof message.id !== 'number') {
        if (typeof message.method === 'string' && message.params && typeof message.params === 'object') {
          for (const listener of this.listeners) {
            try { listener(message.method, message.params); } catch { /* Diagnostic consumers must not break request handling. */ }
          }
        }
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(new Error('CDP connection closed')));
    socket.addEventListener('error', () => { this.fail(new Error('CDP connection failed')); socket.close(); });
  }

  get isOpen(): boolean { return !this.closed && this.socket.readyState === 1; }

  onEvent(listener: EventListener): () => void {
    if (!this.closed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
    this.listeners.clear();
  }

  static open(webSocketUrl: string, options: ConnectionOptions = {}): Promise<CdpConnection> {
    const url = new URL(webSocketUrl);
    assertLoopbackCdpUrl(webSocketUrl, Number(url.port));
    const timeoutMs = options.timeoutMs ?? 5000;
    return new Promise((resolve, reject) => {
      const socket = (options.createSocket ?? ((address) => new WebSocket(address)))(webSocketUrl);
      const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', onOpen); socket.removeEventListener('error', onError); socket.removeEventListener('close', onClose); };
      const onOpen = () => { cleanup(); resolve(new CdpConnection(socket, timeoutMs)); };
      const onError = () => { cleanup(); socket.close(); reject(new Error('Unable to open CDP websocket')); };
      const onClose = () => { cleanup(); reject(new Error('CDP websocket closed before opening')); };
      const timer = setTimeout(() => { cleanup(); socket.close(); reject(new Error('CDP websocket connection timed out')); }, timeoutMs);
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onClose, { once: true });
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.isOpen) return Promise.reject(new Error('CDP connection is not open'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP request timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  close(): void { this.fail(new Error('CDP connection closed')); this.socket.close(); }
}
