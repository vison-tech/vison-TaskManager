import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { embedPathPrefix, embedProtocolVersion, embedSessionPath, type EmbedSessionInfo } from '../../packages/contracts/embed.ts';

export interface EmbeddedAccessOptions { accessToken?: string; now?: () => number }
type Session = EmbedSessionInfo & { closeStreams: Set<() => void> };
const lifetimeMs = 8 * 60 * 60 * 1000;
const secretPattern = /^[a-f0-9]{64}$/;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const allowedHeaders = 'Content-Type, X-TaskManager-Actor, Last-Event-ID';

function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function isLocal(url: URL): boolean { return url.protocol === 'http:' && loopbackHosts.has(url.hostname); }

function bootstrapError(request: Request, accessToken?: string): Response | null {
  if (!isLocal(new URL(request.url)) || request.headers.has('Origin') || request.headers.has('Sec-Fetch-Site')) {
    return failure(403, 'EMBED_BOOTSTRAP_FORBIDDEN', 'Embedding must be started by the local injector.');
  }
  if (accessToken) {
    const actual = Buffer.from(request.headers.get('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${accessToken}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return failure(401, 'UNAUTHORIZED', 'A valid instance token is required to start embedding.');
    }
  }
  return null;
}

function scopedResponse(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) if (name.startsWith('access-control-')) headers.delete(name);
  headers.delete('set-cookie');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Vary', [...new Set([...(headers.get('Vary') ?? '').split(',').map((value) => value.trim()).filter(Boolean), 'Origin'])].join(', '));
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', allowedHeaders);
    headers.set('Access-Control-Allow-Private-Network', 'true');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function allowedPath(value: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/%(?:2f|5c|25)/i.test(value) || /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//')) return false;
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  if (decoded === '/api/v1/session' || decoded.startsWith('/api/v1/session/') || decoded === embedSessionPath || decoded.startsWith(`${embedSessionPath}/`)) return false;
  return decoded === '/' || decoded.startsWith('/assets/') || decoded.startsWith('/api/v1/');
}

/** Preserve backpressure and stop live event access when the short-lived capability is revoked. */
function sessionEvents(response: Response, session: Session, signal: AbortSignal, now: () => number): Response {
  if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) return response;
  const reader = response.body.getReader();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        session.closeStreams.delete(stop);
        void reader.cancel().catch(() => undefined);
        try { controller.close(); } catch { /* Already cancelled by the client. */ }
      };
      session.closeStreams.add(stop);
      signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(stop, Math.max(0, session.expiresAt - now()));
      timer.unref();
      if (signal.aborted) stop();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (closed) return;
        if (chunk.done) stop();
        else controller.enqueue(chunk.value);
      } catch (error) {
        if (closed) return;
        controller.error(error);
        stop();
      }
    },
    cancel() { stop(); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** A capability gateway for opaque frames; ordinary Web/API authorization stays in webApp. */
export function withEmbeddedAccess(webApp: Hono, options: EmbeddedAccessOptions = {}): Hono {
  const app = new Hono();
  const sessions = new Map<string, Session>();
  const now = options.now ?? Date.now;
  const accessToken = options.accessToken ?? process.env.TASKMANAGER_ACCESS_TOKEN;
  const revoke = (id: string) => {
    const session = sessions.get(id);
    if (session) for (const stop of [...session.closeStreams]) stop();
    sessions.delete(id);
  };
  const prune = () => { for (const [id, session] of sessions) if (session.expiresAt <= now()) revoke(id); };

  app.all('*', async (c) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    if (url.pathname === embedSessionPath || url.pathname.startsWith(`${embedSessionPath}/`)) {
      const error = bootstrapError(request, accessToken);
      if (error) return scopedResponse(error);
      prune();
      if (url.pathname === embedSessionPath && request.method === 'POST') {
        if (sessions.size >= 64) return scopedResponse(failure(503, 'EMBED_SESSION_LIMIT', 'Too many active embedding sessions.'));
        const info: EmbedSessionInfo = { protocolVersion: embedProtocolVersion, id: randomBytes(32).toString('hex'), proofKey: randomBytes(32).toString('hex'), expiresAt: now() + lifetimeMs };
        sessions.set(info.id, { ...info, closeStreams: new Set() });
        return scopedResponse(Response.json(info, { status: 201 }));
      }
      const id = url.pathname.slice(embedSessionPath.length + 1);
      if (request.method === 'DELETE' && secretPattern.test(id)) {
        revoke(id);
        return scopedResponse(new Response(null, { status: 204 }));
      }
      return scopedResponse(failure(405, 'METHOD_NOT_ALLOWED', 'Unsupported embedding session operation.'));
    }
    if (!url.pathname.startsWith(embedPathPrefix)) return webApp.fetch(request);

    const origin = request.headers.get('Origin');
    const acceptedOrigin = origin === 'null' || origin === url.origin;
    if (!isLocal(url) || (origin !== null && !acceptedOrigin)) {
      return scopedResponse(failure(403, 'ORIGIN_NOT_ALLOWED', 'This origin cannot use an embedding session.'));
    }
    const respond = (response: Response) => scopedResponse(response, acceptedOrigin ? origin! : undefined);
    const tail = url.pathname.slice(embedPathPrefix.length);
    const separator = tail.indexOf('/');
    const id = separator < 0 ? tail : tail.slice(0, separator);
    const path = separator < 0 ? '' : tail.slice(separator);
    prune();
    const session = secretPattern.test(id) ? sessions.get(id) : undefined;
    if (!session) return respond(failure(401, 'EMBED_SESSION_EXPIRED', 'The embedding session has expired; restart the injector.'));
    if (!allowedPath(path)) return respond(failure(403, 'EMBED_PATH_FORBIDDEN', 'This path is not available to the embedded page.'));
    if (request.method === 'OPTIONS') {
      const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
      const allowed = allowedHeaders.toLowerCase().split(', ');
      if (requestedHeaders.some((value) => !allowed.includes(value))) return respond(failure(403, 'EMBED_HEADERS_FORBIDDEN', 'Unsupported embedding request headers.'));
      return respond(new Response(null, { status: 204 }));
    }
    const challenge = request.headers.get('X-TaskManager-Challenge');
    if (challenge !== null && (path !== '/' || request.method !== 'GET' || !secretPattern.test(challenge))) {
      return respond(failure(400, 'INVALID_EMBED_CHALLENGE', 'Invalid document identity challenge.'));
    }
    const headers = new Headers(request.headers);
    for (const name of ['Origin', 'Cookie', 'Authorization', 'X-TaskManager-CSRF', 'X-TaskManager-Challenge', 'Host']) headers.delete(name);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const forwarded = new Request(`${url.origin}${path}${url.search}`, {
      method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      signal: request.signal, ...(request.body ? { duplex: 'half' } : {}),
    } as RequestInit);
    let response = await webApp.fetch(forwarded);
    if (challenge && response.ok && response.headers.get('Content-Type')?.includes('text/html')) {
      const html = await response.text();
      const digest = createHash('sha256').update(html).digest('hex');
      const proof = createHmac('sha256', session.proofKey).update(`${challenge}.${digest}`).digest('hex');
      const signedHeaders = new Headers(response.headers);
      signedHeaders.delete('Content-Length');
      signedHeaders.set('X-TaskManager-Proof', proof);
      response = new Response(html, { status: response.status, statusText: response.statusText, headers: signedHeaders });
    }
    return respond(sessionEvents(response, session, request.signal, now));
  });
  return app;
}
