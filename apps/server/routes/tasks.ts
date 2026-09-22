import type { Hono } from 'hono';
import { actor, body, routeId, versionQuery } from '../context.ts';
import { Storage } from '../storage.ts';
import { taskCreate, taskPatch } from '../validation.ts';

export function registerTaskRoutes(app: Hono, storage: Storage): void {
  app.get('/api/v1/tasks', (c) => c.json({ items: storage.listTasks({ projectId: c.req.query('projectId'), status: c.req.query('status'), search: c.req.query('search'), archived: c.req.query('archived') ?? 'false' }), nextCursor: null }));
  app.post('/api/v1/tasks', async (c) => { const input = await body(c, taskCreate); return c.json({ item: storage.write(() => storage.createTask(input, actor(c.req.raw))) }, 201); });
  app.get('/api/v1/tasks/:id', (c) => c.json({ item: storage.detail(routeId(c.req.param('id'))) }));
  app.patch('/api/v1/tasks/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, taskPatch); return c.json({ item: storage.write(() => storage.updateTask(id, input, actor(c.req.raw))) }); });
  app.delete('/api/v1/tasks/:id', (c) => { const id = routeId(c.req.param('id')); storage.write(() => storage.deleteTask(id, versionQuery(c.req.query('version')))); return c.body(null, 204); });
}
