import { ApiError, DEFAULT_TASKMANAGER_URL, TaskClient } from '../../packages/client/index.ts';
import { execute } from './execute.ts';
import { parseArgs } from './core/args.ts';
import { output, usage } from './core/output.ts';
import { CliError, type Output } from './core/types.ts';

export async function runCli(argv: string[], client = new TaskClient({ baseUrl: process.env.TASKMANAGER_URL || DEFAULT_TASKMANAGER_URL, actor: process.env.TASKMANAGER_ACTOR || 'taskctl', accessToken: process.env.TASKMANAGER_ACCESS_TOKEN }), io: Output = process): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.flags.get('help') === true || args.positionals.length === 0) { io.stdout.write(usage); return 0; }
    output(await execute(args, client), args, io); return 0;
  } catch (error) {
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    io.stderr.write(`taskctl: ${message}\n`);
    return error instanceof CliError ? error.exitCode : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli(process.argv.slice(2));
