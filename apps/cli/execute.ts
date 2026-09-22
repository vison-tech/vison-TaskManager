import type { TaskClient } from '../../packages/client/index.ts';
import { positional } from './core/args.ts';
import type { ParsedArgs } from './core/types.ts';
import { CliError } from './core/types.ts';
import { projectCommand } from './commands/projects.ts';
import { taskCommand } from './commands/tasks.ts';

export async function execute(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const resource = positional(args.positionals[0], 'resource');
  if (resource === 'projects' || resource === 'project') return projectCommand(args, client);
  if (resource === 'tasks' || resource === 'task') return taskCommand(args, client);
  throw new CliError(`Unknown resource: ${resource}`);
}
