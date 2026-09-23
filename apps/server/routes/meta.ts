import type { Hono } from 'hono';
import type { Storage } from '../storage.ts';

export function registerMetaRoutes(app: Hono, storage: Storage): void {
  app.get('/health', (c) => c.json({ ok: true, revision: storage.revision() }));
  app.get('/api/v1/meta', (c) => c.json({ version: '0.1.0', capabilities: { comments: true, attachments: true, relations: true, sessions: true, realtime: true } }));
  app.get('/api/v1/snapshot', (c) => c.json({ projects: storage.listProjects(), tasks: storage.listTasks({ archived: 'false' }), relations: storage.listProjects().flatMap((project) => storage.listProjectRelations(project.id)), revision: storage.revision() }));
}
