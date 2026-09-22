import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError } from './validation.ts';
import { Storage } from './storage.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerCollaborationRoutes } from './routes/collaboration.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerTaskRoutes } from './routes/tasks.ts';

export interface TaskManagerApp { app: Hono; storage: Storage; close: () => void; }

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

  registerMetaRoutes(app, storage);
  registerProjectRoutes(app, storage);
  registerTaskRoutes(app, storage);
  registerCollaborationRoutes(app, storage);
  registerAttachmentRoutes(app, storage);
  registerEventRoutes(app, storage);

  return { app, storage, close: () => storage.close() };
}
