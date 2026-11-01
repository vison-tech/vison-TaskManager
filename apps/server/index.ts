import { createAdaptorServer } from '@hono/node-server';
import { createTaskManagerApp } from './app.ts';
import { withWebAssets } from './web.ts';
import { startServerLifecycle } from './lifecycle.ts';

const port = Number(process.env.PORT ?? 47830);
const hostname = process.env.HOST ?? '127.0.0.1';
const accessToken = process.env.TASKMANAGER_ACCESS_TOKEN;
const runtime = createTaskManagerApp({ accessToken });
const server = createAdaptorServer({ fetch: withWebAssets(runtime.app, undefined, { accessToken }).fetch });
const instanceId = process.env.TASKMANAGER_LAUNCHER_ID;
startServerLifecycle({
  server, port, hostname, closeRuntime: runtime.close,
  onListening: (actualPort) => { console.log(`TaskManager listening on http://${hostname}:${actualPort}`); },
  parent: process.send && instanceId ? {
    connected: () => process.connected,
    ready: (actualPort, failed) => {
      process.send!({ type: 'taskmanager:ready', instanceId, role: 'server', port: actualPort }, (error) => { if (error) failed(error); });
    },
    disconnect: () => { process.disconnect(); },
  } : undefined,
});
