import { fileURLToPath } from 'node:url';
import { runLauncher } from './commands.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
runLauncher(process.argv.slice(2), root, { bundled: import.meta.url.endsWith('.mjs') }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'TaskManager launcher failed.');
  process.exitCode = 1;
});
