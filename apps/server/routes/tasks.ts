import type { Hono } from 'hono';
import { actor, body, routeId, versionQuery } from '../context.ts';
import { Storage } from '../storage.ts';
import { taskComplete, taskCopy, taskCreate, taskPatch } from '../validation.ts';

export function registerTaskRoutes(app: Hono, storage: Storage): void {
  app.get('/api/v1/tasks', (c) => c.json(storage.listTasksPage({ projectId: c.req.query('projectId'), status: c.req.query('status'), search: c.req.query('search'), archived: c.req.query('archived') ?? 'false', cursor: c.req.query('cursor'), limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined })));
  app.post('/api/v1/tasks', async (c) => { const input = await body(c, taskCreate); return c.json({ item: storage.write(() => storage.createTask(input, actor(c.req.raw)), { resource: 'task', resourceId: input.projectId }) }, 201); });
  app.get('/api/v1/tasks/:id', (c) => c.json({ item: storage.detail(routeId(c.req.param('id'))) }));
  app.get('/api/v1/tasks/:id/tree', (c) => { const depth = Number(c.req.query('depth') ?? 5); const direction = c.req.query('direction') ?? 'descendants'; if (!Number.isInteger(depth) || depth < 0 || depth > 20 || !['ancestors', 'descendants'].includes(direction)) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'direction or depth is invalid', requestId: crypto.randomUUID() } }, 422); return c.json(storage.tree(routeId(c.req.param('id')), direction as 'ancestors' | 'descendants', depth)); });
  app.get('/api/v1/tasks/:id/activities', (c) => c.json(storage.listActivitiesPage(routeId(c.req.param('id')), c.req.query('cursor'), Number(c.req.query('limit') ?? 100))));
  app.post('/api/v1/tasks/:id/copy', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, taskCopy); return c.json({ item: storage.write(() => storage.copyTask(id, input, actor(c.req.raw)), { resource: 'task', resourceId: id }) }, 201); });
  app.post('/api/v1/tasks/:id/complete', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, taskComplete); return c.json(storage.write(() => storage.completeTask(id, input.version, actor(c.req.raw)), { resource: 'task', resourceId: id })); });
  app.patch('/api/v1/tasks/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, taskPatch); return c.json({ item: storage.write(() => storage.updateTask(id, input, actor(c.req.raw)), { resource: 'task', resourceId: id }) }); });
  app.delete('/api/v1/tasks/:id', (c) => { const id = routeId(c.req.param('id')); storage.write(() => storage.deleteTask(id, versionQuery(c.req.query('version'))), { resource: 'task', resourceId: id }); return c.body(null, 204); });
}
