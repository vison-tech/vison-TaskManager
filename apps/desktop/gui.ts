import { fileURLToPath } from 'node:url';
import { runLauncher } from './commands.ts';

// The native app owns stdin. EOF also arrives if that parent crashes or is killed.
const controller = new AbortController();
process.stdin.once('end', () => controller.abort());
process.stdin.once('error', () => controller.abort());
process.stdin.resume();
const root = fileURLToPath(new URL('../../', import.meta.url));
runLauncher(process.argv.slice(2), root, { bundled: true, signal: controller.signal }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'TaskManager could not start.');
  process.exitCode = 1;
}).finally(() => { process.stdin.destroy(); });
