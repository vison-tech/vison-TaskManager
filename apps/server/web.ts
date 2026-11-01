import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { withEmbeddedAccess, type EmbeddedAccessOptions } from './embed.ts';

/** Serve the public Web bundle without relaxing the API's session/token checks. */
export function withWebAssets(api: Hono, webRoot = fileURLToPath(new URL('../../dist/web/', import.meta.url)), options: EmbeddedAccessOptions = {}): Hono {
  const app = new Hono();
  const indexFile = join(webRoot, 'index.html');
  app.get('/', async (c, next) => {
    if (!existsSync(indexFile)) return c.text('TaskManager Web is not built. Run npm run build, then refresh.', 503);
    c.header('Cache-Control', 'no-cache');
    return serveStatic({ path: indexFile })(c, next);
  });
  app.get('/assets/*', async (c, next) => {
    if (!existsSync(webRoot)) return c.notFound();
    return serveStatic({ root: webRoot })(c, next);
  });
  app.all('*', (c) => api.fetch(c.req.raw));
  return withEmbeddedAccess(app, options);
}
