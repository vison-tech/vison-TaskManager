import type { Hono } from 'hono';
import { body, routeId, versionQuery } from '../context.ts';
import { Storage } from '../storage.ts';
import { projectCreate, projectPatch } from '../validation.ts';

export function registerProjectRoutes(app: Hono, storage: Storage): void {
  app.get('/api/v1/projects', (c) => c.json({ items: storage.listProjects(), nextCursor: null }));
  app.post('/api/v1/projects', async (c) => { const input = await body(c, projectCreate); return c.json({ item: storage.write(() => storage.createProject(input), { resource: 'project' }) }, 201); });
  app.patch('/api/v1/projects/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, projectPatch); return c.json({ item: storage.write(() => storage.updateProject(id, input), { resource: 'project', resourceId: id }) }); });
  app.delete('/api/v1/projects/:id', (c) => { const id = routeId(c.req.param('id')); storage.write(() => storage.deleteProject(id, versionQuery(c.req.query('version'))), { resource: 'project', resourceId: id }); return c.body(null, 204); });
}
