export interface TaskClientOptions {
  baseUrl?: string;
  actor?: string;
  accessToken?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export const DEFAULT_TASKMANAGER_URL = 'http://127.0.0.1:47830';

interface ErrorEnvelope { error?: { code?: string; message?: string; details?: unknown; requestId?: string }; }

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown, public readonly requestId?: string, options?: ErrorOptions) {
    super(message, options); this.name = 'ApiError';
  }
}

export function expectedVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('An explicit positive integer version is required');
  return version;
}

const id = encodeURIComponent;

export class HttpTransport {
  readonly baseUrl: string;
  readonly actor: string;
  readonly timeoutMs: number;
  readonly accessToken?: string;
  private readonly fetch: typeof globalThis.fetch;
  private csrfToken?: string;

  constructor(options: TaskClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_TASKMANAGER_URL).replace(/\/$/, '');
    this.actor = options.actor ?? 'agent';
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  private url(path: string): string { return `${this.baseUrl}${path}`; }
  attachmentUrl(attachmentId: string): string { return this.url(`/api/v1/attachments/${id(attachmentId)}`); }

  async bootstrapSession(): Promise<{ csrfToken: string; expiresIn: number }> {
    const response = await this.send('/api/v1/session', { method: 'POST', credentials: 'include', headers: { 'X-TaskManager-Actor': this.actor } }, 3_000);
    if (!response.ok) throw await this.responseError(response);
    const payload = await response.json() as { item: { csrfToken: string; expiresIn: number } };
    this.csrfToken = payload.item.csrfToken;
    return payload.item;
  }

  private async responseError(response: Response): Promise<ApiError> {
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) as ErrorEnvelope | null : null;
    const text = payload ? undefined : await response.text().catch(() => '');
    return new ApiError(response.status, payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? text ?? response.statusText ?? `Request failed (${response.status})`, payload?.error?.details, payload?.error?.requestId);
  }

  private async send(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    try {
      // Each operation performs exactly one fetch. In particular, writes are never retried.
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      if (this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path !== '/api/v1/session') headers.set('X-TaskManager-CSRF', this.csrfToken);
      return await this.fetch(this.url(path), { ...init, headers, credentials: init.credentials ?? 'include', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new ApiError(0, timedOut ? 'REQUEST_TIMEOUT' : 'CONNECTION_ERROR', timedOut ? `Request timed out after ${timeoutMs} ms` : 'Unable to reach TaskManager', undefined, undefined, { cause: error });
    }
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const multipart = body instanceof FormData;
    const response = await this.send(path, { method, headers: { 'X-TaskManager-Actor': this.actor, ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}), ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    if (!response.ok) throw await this.responseError(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async download(path: string): Promise<Uint8Array> {
    const response = await this.send(path, { headers: { 'X-TaskManager-Actor': this.actor, ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}) } });
    if (!response.ok) throw await this.responseError(response);
    return new Uint8Array(await response.arrayBuffer());
  }
}
