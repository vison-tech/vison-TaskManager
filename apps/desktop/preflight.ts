import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

export async function assertLauncherAssets(root: string): Promise<void> {
  try { await access(join(root, 'dist/web/index.html'), constants.R_OK); }
  catch { throw new Error('Web files are missing. Run npm run build, then launch again.'); }
}

/** Test the exact loopback address before opening the data store. The child still handles bind races. */
export async function assertLauncherPort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Stop the existing service yourself or choose --port <another-port>. No existing process was changed.`
        : `Cannot listen on 127.0.0.1:${port} (${error.code ?? 'unknown error'}).`));
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve()));
  });
}
