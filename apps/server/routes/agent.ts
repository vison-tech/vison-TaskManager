import type { Hono } from 'hono';
import { agentRunContinue, agentRunCreate, fail } from '../validation.ts';
import { body, routeId } from '../context.ts';
import { AgentRuntime, AgentRuntimeError } from '../../../packages/agent-runtime/index.ts';

function runtimeError(error: unknown): never {
  if (error instanceof AgentRuntimeError) {
    const status = error.code === 'SESSION_BUSY' ? 409 : error.code === 'RUN_NOT_FOUND' ? 404 : 422;
    fail(status, error.code, error.message);
  }
  throw error;
}

export function registerAgentRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/api/v1/agent/capabilities', (c) => c.json(runtime.capabilities()));
  app.get('/api/v1/agent/skills', (c) => c.json({ items: runtime.skills() }));
  app.post('/api/v1/agent/runs', async (c) => { const input = await body(c, agentRunCreate); try { return c.json({ item: runtime.start(input) }, 201); } catch (error) { return runtimeError(error); } });
  app.get('/api/v1/agent/runs/:id', (c) => { const run = runtime.get(routeId(c.req.param('id'))); if (!run) fail(404, 'RUN_NOT_FOUND', 'Run not found'); return c.json({ item: run }); });
  app.get('/api/v1/agent/runs/:id/events', (c) => { const id = routeId(c.req.param('id')); if (!runtime.get(id)) fail(404, 'RUN_NOT_FOUND', 'Run not found'); const after = Number(c.req.query('after') ?? 0); if (!Number.isInteger(after) || after < 0) fail(422, 'INVALID_CURSOR', 'after must be a non-negative integer'); const items = runtime.eventsSince(id, after); return c.json({ items, nextCursor: items.at(-1)?.sequence ?? after }); });
  app.get('/api/v1/agent/runs/:id/events/stream', (c) => {
    const id = routeId(c.req.param('id'));
    if (!runtime.get(id)) fail(404, 'RUN_NOT_FOUND', 'Run not found');
    const requestedAfter = c.req.query('after');
    const headerAfter = c.req.header('Last-Event-ID');
    const after = Number(requestedAfter ?? headerAfter ?? 0);
    if (!Number.isInteger(after) || after < 0) fail(422, 'INVALID_CURSOR', 'after must be a non-negative integer');
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let closeStream: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const send = (event: import('../../../packages/agent-runtime/index.ts').AgentEvent) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: agent\ndata: ${JSON.stringify({ protocolVersion: '1', ...event })}\n\n`)); }
          catch { closeStream?.(); }
        };
        const listener = (event: import('../../../packages/agent-runtime/index.ts').AgentEvent) => send(event);
        unsubscribe = runtime.subscribe(id, listener);
        for (const event of runtime.eventsSince(id, after)) send(event);
        timer = setInterval(() => { if (!closed) { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { closeStream?.(); } } }, 25_000);
        closeStream = () => { if (closed) return; closed = true; unsubscribe?.(); if (timer) clearInterval(timer); try { controller.close(); } catch { /* Already closed. */ } };
      },
      cancel() { closeStream?.(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  });
  app.post('/api/v1/agent/runs/:id/cancel', (c) => { try { return c.json({ item: runtime.cancel(routeId(c.req.param('id'))) }); } catch (error) { return runtimeError(error); } });
  app.post('/api/v1/agent/runs/:id/continue', async (c) => { const input = await body(c, agentRunContinue); try { return c.json({ item: runtime.continue(routeId(c.req.param('id')), input.input) }, 201); } catch (error) { return runtimeError(error); } });
}
