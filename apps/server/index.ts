import { serve } from '@hono/node-server';
import { createTaskManagerApp } from './app.ts';

const port = Number(process.env.PORT ?? 47830);
const runtime = createTaskManagerApp();
const server = serve({ fetch: runtime.app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' });
console.log(`TaskManager listening on http://127.0.0.1:${port}`);
const close = () => { runtime.close(); server.close(); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
