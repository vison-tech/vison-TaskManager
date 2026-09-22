import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Session, TaskDetail } from '../../../packages/contracts/index.ts';
import type { TaskClient } from '../../../packages/client/index.ts';
import { enumFlag, flag, numberFlag, positional, requireNoExtraPositionals } from '../core/args.ts';
import { readInputFile } from '../core/input.ts';
import type { ParsedArgs } from '../core/types.ts';
import { CliError } from '../core/types.ts';

async function detail(client: TaskClient, taskId: string): Promise<TaskDetail> { return client.getTask(taskId); }

export async function commentCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'comment command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).comments; }
    case 'add': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return client.addComment(taskId, flag(args, 'body', true)!); }
    case 'update': { const commentId = positional(args.positionals[3], 'comment id'); requireNoExtraPositionals(args, 4); return client.updateComment(commentId, flag(args, 'body', true)!, numberFlag(args, 'version', true)!); }
    case 'delete': { const commentId = positional(args.positionals[3], 'comment id'); requireNoExtraPositionals(args, 4); await client.deleteComment(commentId, numberFlag(args, 'version', true)!); return { ok: true, deleted: commentId }; }
    default: throw new CliError(`Unknown comment command: ${action}`);
  }
}

export async function relationCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'relation command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).relations; }
    case 'add': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const type = enumFlag(args, 'type', ['parent', 'blocks', 'related'] as const); if (!type) throw new CliError('Missing required option: --type'); return client.addRelation(taskId, flag(args, 'target', true)!, type, numberFlag(args, 'version', true)!); }
    case 'remove': { const relationId = positional(args.positionals[3], 'relation id'); requireNoExtraPositionals(args, 4); await client.removeRelation(relationId, flag(args, 'task', true)!, numberFlag(args, 'version', true)!); return { ok: true, deleted: relationId }; }
    default: throw new CliError(`Unknown relation command: ${action}`);
  }
}

export async function attachmentCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'attachment command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).attachments; }
    case 'upload': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const path = flag(args, 'file', true)!; return client.uploadAttachment(taskId, await readInputFile(path), basename(path), flag(args, 'comment')); }
    case 'download': {
      const attachmentId = positional(args.positionals[3], 'attachment id'); requireNoExtraPositionals(args, 4); const path = resolve(flag(args, 'output', true)!); await writeFile(path, await client.downloadAttachment(attachmentId)); return { ok: true, attachmentId, output: path };
    }
    case 'delete': { const attachmentId = positional(args.positionals[3], 'attachment id'); requireNoExtraPositionals(args, 4); await client.deleteAttachment(attachmentId); return { ok: true, deleted: attachmentId }; }
    default: throw new CliError(`Unknown attachment command: ${action}`);
  }
}

export async function sessionCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'session command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).task.sessions; }
    case 'add': {
      const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const platform = enumFlag(args, 'platform', ['codex', 'claude', 'pi', 'agy', 'grok'] as const); if (!platform) throw new CliError('Missing required option: --platform'); const sessionId = flag(args, 'session-id', true)!;
      const input: Omit<Session, 'id'> & { version: number } = { platform, sessionId, version: numberFlag(args, 'version', true)! };
      for (const [option, key] of [['project-id', 'projectId'], ['host-id', 'hostId'], ['workspace-path', 'workspacePath'], ['project-kind', 'projectKind']] as const) { const value = flag(args, option); if (value !== undefined) (input as Record<string, unknown>)[key] = value; }
      if (input.projectKind && input.projectKind !== 'local' && input.projectKind !== 'remote') throw new CliError('--project-kind must be local or remote');
      return client.addSession(taskId, input);
    }
    case 'remove': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const sessionId = flag(args, 'session-id', true)!; await client.removeSession(taskId, sessionId, numberFlag(args, 'version', true)!); return { ok: true, taskId, sessionId }; }
    default: throw new CliError(`Unknown session command: ${action}`);
  }
}
