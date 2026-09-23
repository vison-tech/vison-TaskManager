import type { Hono } from 'hono';
import type { RevisionRecord, Storage } from '../storage.ts';

export function registerEventRoutes(app: Hono, storage: Storage): void {
  app.get('/api/v1/events', (c) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    let closeStream: (() => void) | undefined;
    const resource = c.req.query('resource') as RevisionRecord['resource'];
    const resourceId = c.req.query('resourceId');
    const allowedResources = new Set(['project', 'task', 'comment', 'attachment', 'relation', 'session', 'readme']);
    if (resource && !allowedResources.has(resource)) return new Response('Invalid resource filter', { status: 422 });
    const matches = (event: RevisionRecord) => (!resource || event.resource === resource) && (!resourceId || event.resourceId === resourceId);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const parsedLastEventId = Number(c.req.header('Last-Event-ID'));
        const hasLastEventId = Number.isSafeInteger(parsedLastEventId) && parsedLastEventId >= 0;
        let lastSeen = hasLastEventId ? parsedLastEventId : Math.max(-1, storage.revision() - 1);
        const send = (event: RevisionRecord) => {
          if (event.revision <= lastSeen) return;
          lastSeen = event.revision;
          if (!matches(event)) return;
          try { controller.enqueue(encoder.encode(`id: ${event.revision}\nevent: revision\ndata: ${JSON.stringify({ protocolVersion: '1', ...event })}\n\n`)); } catch { /* Client closed the stream. */ }
        };
        const listener = (event: RevisionRecord) => send(event);
        storage.subscribers.add(listener);
        unsubscribe = () => storage.subscribers.delete(listener);
        const current = storage.revision();
        const replay = hasLastEventId ? storage.revisionsSince(parsedLastEventId) : [];
        if (replay.length > 0) replay.forEach(send); else if (!hasLastEventId && !resource) send({ revision: current }); else if (current > lastSeen) lastSeen = current;
        pollTimer = setInterval(() => { const latest = storage.revision(); if (latest <= lastSeen) return; storage.revisionsSince(lastSeen).forEach(send); }, 250);
        timer = setInterval(() => { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* Client closed the stream. */ } }, 25_000);
        closeStream = () => { unsubscribe?.(); if (timer) clearInterval(timer); if (pollTimer) clearInterval(pollTimer); storage.closers.delete(closeStream!); try { controller.close(); } catch { /* Already closed. */ } };
        storage.closers.add(closeStream);
      },
      cancel() { closeStream?.(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
  });
}
