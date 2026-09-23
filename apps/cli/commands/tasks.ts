import type { TaskInput, TaskPatch } from '../../../packages/contracts/index.ts';
import type { TaskClient } from '../../../packages/client/index.ts';
import { boundedNumberFlag, enumFlag, flag, flagAlias, numberFlag, positional, requireNoExtraPositionals, taskFields } from '../core/args.ts';
import { taskSummary } from '../core/output.ts';
import type { ParsedArgs } from '../core/types.ts';
import { CliError } from '../core/types.ts';
import { attachmentCommand, commentCommand, relationCommand, sessionCommand } from './collaboration.ts';

export async function taskCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[1], 'task command');
  switch (action) {
    case 'list': {
      requireNoExtraPositionals(args, 2); const archived = flag(args, 'archived');
      if (archived !== undefined && archived !== 'true' && archived !== 'false' && archived !== 'all') throw new CliError('--archived must be false, true, or all');
      return (await client.listTasks({ projectId: flagAlias(args, ['project', 'project-id']), status: flag(args, 'status'), search: flag(args, 'search'), archived: archived as boolean | 'all' | undefined })).map(taskSummary);
    }
    case 'get': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.getTask(id); }
    case 'create': { requireNoExtraPositionals(args, 2); const fields = taskFields(args, true); if (!fields.title) throw new CliError('Missing required option: --title'); return client.createTask(fields as TaskInput); }
    case 'update': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); const version = numberFlag(args, 'version', true); const fields = taskFields(args, false); if (Object.keys(fields).length === 0) throw new CliError('At least one task field is required'); return client.updateTask(id, { ...fields, version: version! } as TaskPatch); }
    case 'complete': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.completeTask(id, numberFlag(args, 'version', true)!); }
    case 'archive': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.archiveTask(id, numberFlag(args, 'version', true)!); }
    case 'restore': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.restoreTask(id, numberFlag(args, 'version', true)!); }
    case 'delete': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); await client.deleteTask(id, numberFlag(args, 'version', true)!); return { ok: true, deleted: id }; }
    case 'tree': { const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); const direction = enumFlag(args, 'direction', ['ancestors', 'descendants'] as const) ?? 'descendants'; const depth = boundedNumberFlag(args, 'depth', 0, 20) ?? 5; return client.tree(id, direction, depth); }
    case 'comments': return commentCommand(args, client);
    case 'relations': return relationCommand(args, client);
    case 'attachments': return attachmentCommand(args, client);
    case 'sessions': return sessionCommand(args, client);
    default: throw new CliError(`Unknown task command: ${action}`);
  }
}
