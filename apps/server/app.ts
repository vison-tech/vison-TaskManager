import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Relation } from '../../packages/contracts/index.ts';
import { Storage } from './storage.ts';
import { DomainError, commentCreate, commentPatch, projectCreate, projectPatch, relationCreate, sessionCreate, taskCreate, taskPatch, fail } from './validation.ts';

export interface TaskManagerApp { app: Hono; storage: Storage; close: () => void; }

async function body<T>(context: { req: { json: <R>() => Promise<R> } }, schema: z.ZodType<T>) {
  let value: unknown;
  try { value = await context.req.json(); } catch { fail(400, 'INVALID_JSON', 'Request body must be valid JSON'); }
  const result = schema.safeParse(value);
  if (!result.success) fail(422, 'VALIDATION_ERROR', 'Request body is invalid', result.error.flatten());
  return result.data;
}

function actor(request: Request) { return request.headers.get('X-TaskManager-Actor')?.trim() || 'web-user'; }
function routeId(value: string | undefined) { if (!value) fail(400, 'INVALID_ID', 'A resource id is required'); return decodeURIComponent(value); }

export function createTaskManagerApp(options: { dataDir?: string } = {}): TaskManagerApp {
  const storage = new Storage(options.dataDir ?? process.env.TASKMANAGER_DATA_DIR ?? join(process.cwd(), '.data'));
  const app = new Hono();
  app.use('*', cors({ origin: (origin) => origin ?? '*', credentials: false }));
  app.onError((error, c) => {
    const known = error instanceof DomainError;
    const status = known ? error.status : 500;
    if (!known) console.error(error);
    return c.json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Unexpected server error', ...(known && error.details ? { details: error.details } : {}), requestId: randomUUID() } }, status as ContentfulStatusCode);
  });

  app.get('/health', (c) => c.json({ ok: true, revision: storage.revision() }));
  app.get('/api/v1/meta', (c) => c.json({ version: '0.1.0', capabilities: { comments: true, attachments: true, relations: true, sessions: true, realtime: true } }));
  app.get('/api/v1/snapshot', (c) => c.json({ projects: storage.listProjects(), tasks: storage.listTasks({ archived: 'false' }), revision: storage.revision() }));

  app.get('/api/v1/projects', (c) => c.json({ items: storage.listProjects(), nextCursor: null }));
  app.post('/api/v1/projects', async (c) => { const input = await body(c, projectCreate); return c.json({ item: storage.write(() => storage.createProject(input)) }, 201); });
  app.patch('/api/v1/projects/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, projectPatch); return c.json({ item: storage.write(() => storage.updateProject(id, input)) }); });
  app.delete('/api/v1/projects/:id', (c) => { const id = routeId(c.req.param('id')); const version = Number(c.req.query('version')); if (!Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'version query parameter is required'); storage.write(() => storage.deleteProject(id, version)); return c.body(null, 204); });

  app.get('/api/v1/tasks', (c) => c.json({ items: storage.listTasks({ projectId: c.req.query('projectId'), status: c.req.query('status'), search: c.req.query('search'), archived: c.req.query('archived') ?? 'false' }), nextCursor: null }));
  app.post('/api/v1/tasks', async (c) => { const input = await body(c, taskCreate); return c.json({ item: storage.write(() => storage.createTask(input, actor(c.req.raw))) }, 201); });
  app.get('/api/v1/tasks/:id', (c) => c.json({ item: storage.detail(routeId(c.req.param('id'))) }));
  app.patch('/api/v1/tasks/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, taskPatch); return c.json({ item: storage.write(() => storage.updateTask(id, input, actor(c.req.raw))) }); });
  app.delete('/api/v1/tasks/:id', (c) => { const id = routeId(c.req.param('id')); const version = Number(c.req.query('version')); if (!Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'version query parameter is required'); storage.write(() => storage.deleteTask(id, version)); return c.body(null, 204); });

  app.post('/api/v1/tasks/:id/comments', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, commentCreate); return c.json({ item: storage.write(() => storage.createComment(id, input.body, actor(c.req.raw))) }, 201); });
  app.patch('/api/v1/comments/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, commentPatch); return c.json({ item: storage.write(() => storage.updateComment(id, input.body, input.version, actor(c.req.raw))) }); });
  app.delete('/api/v1/comments/:id', (c) => { const id = routeId(c.req.param('id')); const version = Number(c.req.query('version')); if (!Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'version query parameter is required'); storage.write(() => storage.deleteComment(id, version, actor(c.req.raw))); return c.body(null, 204); });

  app.post('/api/v1/tasks/:id/relations', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, relationCreate); return c.json({ item: storage.write(() => storage.addRelation(id, input.targetId, input.type as Relation['type'], input.version, actor(c.req.raw))) }, 201); });
  app.delete('/api/v1/relations/:id', (c) => { const id = routeId(c.req.param('id')); const taskId = c.req.query('taskId'); const version = Number(c.req.query('version')); if (!taskId || !Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'taskId and version query parameters are required'); storage.write(() => storage.removeRelation(id, taskId, version, actor(c.req.raw))); return c.body(null, 204); });
  app.post('/api/v1/tasks/:id/sessions', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, sessionCreate); return c.json({ item: storage.write(() => storage.addSession(id, input, input.version, actor(c.req.raw))) }, 201); });
  app.delete('/api/v1/tasks/:id/sessions/:sessionId', (c) => { const id = routeId(c.req.param('id')); const sessionId = routeId(c.req.param('sessionId')); const version = Number(c.req.query('version')); if (!Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'version query parameter is required'); return c.json({ item: storage.write(() => storage.removeSession(id, sessionId, version, actor(c.req.raw))) }); });

  app.post('/api/v1/tasks/:id/attachments', async (c) => {
    const id = routeId(c.req.param('id')); const form = await c.req.formData(); const file = form.get('file');
    if (!(file instanceof File)) fail(422, 'VALIDATION_ERROR', 'multipart field file is required');
    if (file.size > 25 * 1024 * 1024) fail(413, 'ATTACHMENT_TOO_LARGE', 'Attachment exceeds 25 MB');
    const commentId = form.get('commentId'); const content = new Uint8Array(await file.arrayBuffer());
    return c.json({ item: storage.write(() => storage.createAttachment(id, { filename: file.name, contentType: file.type || 'application/octet-stream', content }, actor(c.req.raw), typeof commentId === 'string' ? commentId : undefined)) }, 201);
  });
  app.get('/api/v1/attachments/:id', (c) => { const result = storage.getAttachment(routeId(c.req.param('id'))); const disposition = /^(text\/html|image\/svg\+xml)$/i.test(result.attachment.contentType) ? 'attachment' : 'inline'; return new Response(result.content as BodyInit, { headers: { 'Content-Type': result.attachment.contentType, 'Content-Length': String(result.attachment.size), 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.filename)}`, 'X-Content-Type-Options': 'nosniff' } }); });
  app.delete('/api/v1/attachments/:id', (c) => { storage.write(() => storage.deleteAttachment(routeId(c.req.param('id')), actor(c.req.raw))); return c.body(null, 204); });

  app.get('/api/v1/events', (c) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder(); const send = (revision: number) => controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`));
        send(storage.revision()); const listener = (revision: number) => send(revision); storage.subscribers.add(listener); unsubscribe = () => storage.subscribers.delete(listener); timer = setInterval(() => { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* Client closed the stream. */ } }, 25_000);
        storage.closers.add(() => { unsubscribe?.(); if (timer) clearInterval(timer); try { controller.close(); } catch { /* Already closed. */ } });
      },
      cancel() { unsubscribe?.(); if (timer) clearInterval(timer); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
  });

  return { app, storage, close: () => storage.close() };
}
