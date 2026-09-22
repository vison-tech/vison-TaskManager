import type { Hono } from 'hono';
import type { Storage } from '../storage.ts';

export function registerEventRoutes(app: Hono, storage: Storage): void {
  app.get('/api/v1/events', (c) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (revision: number) => controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`));
        send(storage.revision());
        const listener = (revision: number) => send(revision);
        storage.subscribers.add(listener);
        unsubscribe = () => storage.subscribers.delete(listener);
        timer = setInterval(() => { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* Client closed the stream. */ } }, 25_000);
        storage.closers.add(() => { unsubscribe?.(); if (timer) clearInterval(timer); try { controller.close(); } catch { /* Already closed. */ } });
      },
      cancel() { unsubscribe?.(); if (timer) clearInterval(timer); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
  });
}
