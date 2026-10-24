import type { Hono } from 'hono';
import { body, routeId } from '../context.ts';
import { agentThreadCreate, agentThreadPatch, agentTurnCreate, fail } from '../validation.ts';
import type { AgentMessage } from '../../../packages/contracts/index.ts';
import { chatError, ChatService } from '../chat.ts';

function cursor(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(422, 'INVALID_CURSOR', `${name} must be a non-negative integer`);
  return parsed;
}

export function registerChatRoutes(app: Hono, chat: ChatService): void {
  app.get('/api/v1/agent/catalog', (c) => c.json(chat.catalog()));

  app.get('/api/v1/agent/threads', (c) => c.json({ items: chat.listThreads({ projectId: c.req.query('projectId'), taskId: c.req.query('taskId'), limit: cursor(c.req.query('limit'), 'limit') }) }));
  app.post('/api/v1/agent/threads', async (c) => {
    const input = await body(c, agentThreadCreate);
    try { return c.json({ item: chat.createThread(input) }, 201); } catch (error) { return chatError(error); }
  });
  app.get('/api/v1/agent/threads/:id', (c) => c.json({ item: chat.getThread(routeId(c.req.param('id'))) }));
  app.patch('/api/v1/agent/threads/:id', async (c) => {
    const id = routeId(c.req.param('id'));
    const input = await body(c, agentThreadPatch);
    try { return c.json({ item: chat.updateThread(id, input) }); } catch (error) { return chatError(error); }
  });
  app.delete('/api/v1/agent/threads/:id', (c) => {
    const id = routeId(c.req.param('id'));
    const version = Number(c.req.query('version'));
    if (!Number.isInteger(version) || version < 1) fail(422, 'VALIDATION_ERROR', 'version query parameter is required');
    try { chat.deleteThread(id, version); return c.body(null, 204); } catch (error) { return chatError(error); }
  });

  app.get('/api/v1/agent/threads/:id/messages', (c) => {
    const id = routeId(c.req.param('id'));
    return c.json(chat.messages(id, { after: cursor(c.req.query('after'), 'after'), before: cursor(c.req.query('before'), 'before'), limit: cursor(c.req.query('limit'), 'limit') }));
  });

  app.post('/api/v1/agent/threads/:id/turn', async (c) => {
    const id = routeId(c.req.param('id'));
    const input = await body(c, agentTurnCreate);
    try { return c.json({ item: await chat.turn(id, input) }, 201); } catch (error) { return chatError(error); }
  });

  // Message stream: one SSE frame per appended message. It never fabricates output; a thread with no
  // running agent simply stays quiet until the next turn.
  app.get('/api/v1/agent/threads/:id/messages/stream', (c) => {
    const id = routeId(c.req.param('id'));
    const requestedAfter = c.req.query('after');
    const headerAfter = c.req.header('Last-Event-ID');
    const after = Number(requestedAfter ?? headerAfter ?? 0);
    if (!Number.isInteger(after) || after < 0) fail(422, 'INVALID_CURSOR', 'after must be a non-negative integer');
    chat.getThread(id);

    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let closeStream: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let lastSequence = after;
        const send = (message: AgentMessage) => {
          if (closed || message.sequence <= lastSequence) return;
          lastSequence = message.sequence;
          try { controller.enqueue(encoder.encode(`id: ${message.sequence}\nevent: message\ndata: ${JSON.stringify({ protocolVersion: '1', ...message })}\n\n`)); }
          catch { closeStream?.(); }
        };
        const listener = (message: AgentMessage) => send(message);
        unsubscribe = chat.subscribeMessages(id, listener);
        for (const message of chat.messages(id, { after, limit: 500 }).items) send(message);
        timer = setInterval(() => { if (!closed) { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { closeStream?.(); } } }, 25_000);
        closeStream = () => { if (closed) return; closed = true; unsubscribe?.(); if (timer) clearInterval(timer); try { controller.close(); } catch { /* Already closed. */ } };
      },
      cancel() { closeStream?.(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  });
}
