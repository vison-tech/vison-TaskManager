import type { Hono } from 'hono';
import type { Relation } from '../../../packages/contracts/index.ts';
import { actor, body, routeId, versionQuery } from '../context.ts';
import { Storage } from '../storage.ts';
import { commentCreate, commentPatch, fail, relationCreate, sessionCreate } from '../validation.ts';

export function registerCollaborationRoutes(app: Hono, storage: Storage): void {
  app.post('/api/v1/tasks/:id/comments', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, commentCreate); return c.json({ item: storage.write(() => storage.createComment(id, input.body, actor(c.req.raw))) }, 201); });
  app.patch('/api/v1/comments/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, commentPatch); return c.json({ item: storage.write(() => storage.updateComment(id, input.body, input.version, actor(c.req.raw))) }); });
  app.delete('/api/v1/comments/:id', (c) => { const id = routeId(c.req.param('id')); storage.write(() => storage.deleteComment(id, versionQuery(c.req.query('version')), actor(c.req.raw))); return c.body(null, 204); });

  app.post('/api/v1/tasks/:id/relations', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, relationCreate); return c.json({ item: storage.write(() => storage.addRelation(id, input.targetId, input.type as Relation['type'], input.version, actor(c.req.raw))) }, 201); });
  app.delete('/api/v1/relations/:id', (c) => { const id = routeId(c.req.param('id')); const taskId = c.req.query('taskId'); if (!taskId) fail(422, 'VALIDATION_ERROR', 'taskId and version query parameters are required'); storage.write(() => storage.removeRelation(id, taskId, versionQuery(c.req.query('version')), actor(c.req.raw))); return c.body(null, 204); });
  app.post('/api/v1/tasks/:id/sessions', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, sessionCreate); return c.json({ item: storage.write(() => storage.addSession(id, input, input.version, actor(c.req.raw))) }, 201); });
  app.delete('/api/v1/tasks/:id/sessions/:sessionId', (c) => { const id = routeId(c.req.param('id')); const sessionId = routeId(c.req.param('sessionId')); return c.json({ item: storage.write(() => storage.removeSession(id, sessionId, versionQuery(c.req.query('version')), actor(c.req.raw))) }); });
}
