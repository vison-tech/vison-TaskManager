// Minimal Chrome DevTools Protocol client for the Codex (ChatGPT.app) renderer.
// Only loopback endpoints are accepted: the debugging port must never be reachable from the LAN.

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export function cdpHttpUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

/** Accepts only ws://127.0.0.1:<port>/... on the requested port; anything else is rejected before connecting. */
export function assertLoopbackCdpUrl(value: string, port: number): string {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port) {
    throw new Error(`Refusing non-loopback CDP endpoint: ${value}`);
  }
  return url.toString();
}

export async function isCdpReachable(port: number): Promise<boolean> {
  try {
    const response = await fetch(cdpHttpUrl(port, '/json/version'), { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listCdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(cdpHttpUrl(port, '/json/list'), { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`CDP target list failed with HTTP ${response.status}`);
  const targets = (await response.json()) as CdpTarget[];
  return targets.map((target) => ({ ...target, webSocketDebuggerUrl: assertLoopbackCdpUrl(target.webSocketDebuggerUrl, port) }));
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  static open(webSocketUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      socket.addEventListener('open', () => resolve(new CdpConnection(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error('Unable to open CDP websocket')), { once: true });
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}
