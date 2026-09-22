import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { priorities, statuses, type Session, type Task, type TaskDetail, type TaskInput, type TaskPatch } from '../../packages/contracts/index.ts';
import { ApiError, DEFAULT_TASKMANAGER_URL, TaskClient } from '../../packages/client/index.ts';

type FlagValue = string | true;
type ParsedArgs = { positionals: string[]; flags: Map<string, FlagValue>; json: boolean };
type Output = { stdout: { write(value: string): void }; stderr: { write(value: string): void } };

const usage = `TaskManager CLI

Usage:
  taskctl <projects|tasks> <command> [options]

Global options:
  --json                         Print machine-readable JSON
  --help                         Show this help

Project commands:
  projects list [--json]
  projects get <project-id> [--json]
  projects create --name <name> [--prefix <prefix>] [--workspace-path <path>] [--readme <body>]
  projects update <project-id> --version <n> [--name <name>] [--workspace-path <path>] [--readme <body>]
  projects readme <project-id> --version <n> --body <markdown>
  projects delete <project-id> --version <n>

Task commands:
  tasks list [--project <id>] [--status <status>] [--search <text>] [--archived false|true|all]
  tasks get <task-id>
  tasks create --project <id> --title <title> [task fields]
  tasks update <task-id> --version <n> [task fields]
  tasks archive <task-id> --version <n>
  tasks restore <task-id> --version <n>
  tasks delete <task-id> --version <n>
  tasks tree <task-id> [--direction ancestors|descendants] [--depth <n>]
  tasks comments list|add|update|delete ...
  tasks relations list|add|remove ...
  tasks attachments list|upload|download|delete ...
  tasks sessions list|add|remove ...

Task fields:
  --description <text> --status <status> --priority <priority>
  --labels <a,b,c> --assignee <name> --start-date <YYYY-MM-DD>
  --due-date <YYYY-MM-DD> --recurrence <JSON> --development-context <JSON>
`;

class CliError extends Error {
  constructor(message: string, readonly exitCode = 2) { super(message); this.name = 'CliError'; }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') { positionals.push(...argv.slice(index + 1)); break; }
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const raw = token.slice(2);
    if (!raw) throw new CliError('Invalid empty option');
    const equals = raw.indexOf('=');
    const name = equals === -1 ? raw : raw.slice(0, equals);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new CliError(`Invalid option: --${name}`);
    if (flags.has(name)) throw new CliError(`Option may only be provided once: --${name}`);
    if (equals !== -1) flags.set(name, raw.slice(equals + 1));
    else if (name === 'json' || name === 'help') flags.set(name, true);
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new CliError(`Option requires a value: --${name}`);
      flags.set(name, value); index += 1;
    }
  }
  return { positionals, flags, json: flags.get('json') === true };
}

function flag(args: ParsedArgs, name: string, required = false): string | undefined {
  const value = args.flags.get(name);
  if (value === true) throw new CliError(`Option requires a value: --${name}`);
  if (required && value === undefined) throw new CliError(`Missing required option: --${name}`);
  return value;
}

function flagAlias(args: ParsedArgs, names: string[], required = false): string | undefined {
  const present = names.filter((name) => args.flags.has(name));
  if (present.length > 1) throw new CliError(`Options are mutually exclusive: ${present.map((name) => `--${name}`).join(', ')}`);
  return flag(args, present[0] ?? names[0], required);
}

function positional(value: string | undefined, description: string): string {
  if (!value) throw new CliError(`Missing ${description}`);
  return value;
}

function numberFlag(args: ParsedArgs, name: string, required = false): number | undefined {
  const value = flag(args, name, required);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new CliError(`--${name} must be a positive integer`);
  return number;
}

function boundedNumberFlag(args: ParsedArgs, name: string, minimum: number, maximum: number): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new CliError(`--${name} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

function finiteNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CliError(`--${name} must be a finite number`);
  return number;
}

function enumFlag<T extends readonly string[]>(args: ParsedArgs, name: string, values: T): T[number] | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) throw new CliError(`--${name} must be one of: ${values.join(', ')}`);
  return value as T[number];
}

function jsonFlag<T>(args: ParsedArgs, name: string): T | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  try { return JSON.parse(value) as T; } catch { throw new CliError(`--${name} must contain valid JSON`); }
}

function labelsFlag(args: ParsedArgs): string[] | undefined {
  const value = flag(args, 'labels');
  return value === undefined ? undefined : [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function taskFields(args: ParsedArgs, includeProject: boolean): Partial<TaskInput> {
  const fields: Record<string, unknown> = {};
  if (includeProject) fields.projectId = flagAlias(args, ['project', 'project-id'], true);
  const title = flag(args, 'title'); if (title !== undefined) fields.title = title;
  const description = flag(args, 'description'); if (description !== undefined) fields.description = description;
  const status = enumFlag(args, 'status', statuses); if (status !== undefined) fields.status = status;
  const priority = enumFlag(args, 'priority', priorities); if (priority !== undefined) fields.priority = priority;
  const labels = labelsFlag(args); if (labels !== undefined) fields.labels = labels;
  const assignee = flag(args, 'assignee'); if (assignee !== undefined) fields.assignee = assignee;
  const startDate = flag(args, 'start-date'); if (startDate !== undefined) fields.startDate = startDate;
  const dueDate = flag(args, 'due-date'); if (dueDate !== undefined) fields.dueDate = dueDate;
  const recurrence = jsonFlag<TaskInput['recurrence']>(args, 'recurrence'); if (recurrence !== undefined) fields.recurrence = recurrence;
  const developmentContext = jsonFlag<TaskInput['developmentContext']>(args, 'development-context'); if (developmentContext !== undefined) fields.developmentContext = developmentContext;
  const sortOrder = finiteNumberFlag(args, 'sort-order'); if (sortOrder !== undefined) fields.sortOrder = sortOrder;
  const archivedAt = flag(args, 'archived-at'); if (archivedAt !== undefined) fields.archivedAt = archivedAt;
  return fields as Partial<TaskInput>;
}

function projectFields(args: ParsedArgs, includeVersion: boolean): { version?: number; name?: string; workspacePath?: string | null; readme?: string; labels?: string[] } {
  const fields: { version?: number; name?: string; workspacePath?: string | null; readme?: string; labels?: string[] } = {};
  if (includeVersion) fields.version = numberFlag(args, 'version', true);
  const name = flag(args, 'name'); if (name !== undefined) fields.name = name;
  const workspacePath = flag(args, 'workspace-path'); if (workspacePath !== undefined) fields.workspacePath = workspacePath;
  const readme = flag(args, 'readme'); if (readme !== undefined) fields.readme = readme;
  const labels = labelsFlag(args); if (labels !== undefined) fields.labels = labels;
  return fields;
}

function requireNoExtraPositionals(args: ParsedArgs, from: number): void {
  if (args.positionals.length > from) throw new CliError(`Unexpected argument: ${args.positionals[from]}`);
}

function taskSummary(task: Task) {
  return { identifier: task.identifier, id: task.id, title: task.title, status: task.status, priority: task.priority, projectId: task.projectId, version: task.version, archivedAt: task.archivedAt };
}

function humanValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    if (value.every((item) => item && typeof item === 'object')) return value.map((item) => humanValue(item)).join('\n');
    return value.join(', ');
  }
  if (!value || typeof value !== 'object') return String(value ?? '');
  const record = value as Record<string, unknown>;
  if ('identifier' in record && 'title' in record) {
    return `${record.identifier}  ${record.title}  [${record.status}] ${record.priority}  v${record.version}`;
  }
  if ('prefix' in record && 'name' in record) {
    return `${record.prefix}  ${record.id}  ${record.name}  ${record.taskCount ?? 0} tasks  v${record.version}`;
  }
  if ('body' in record && 'author' in record) return `${record.id}  ${record.author}: ${record.body}  v${record.version}`;
  if ('filename' in record && 'size' in record) return `${record.id}  ${record.filename}  ${record.size} bytes`;
  if ('platform' in record && 'sessionId' in record) return `${record.platform}  ${record.sessionId}`;
  return Object.entries(record).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item ?? '')}`).join('\n');
}

function output(value: unknown, args: ParsedArgs, io: Output): void {
  io.stdout.write(args.json ? `${JSON.stringify(value, null, 2)}\n` : `${humanValue(value)}\n`);
}

async function readInputFile(path: string): Promise<Blob> {
  const content = await readFile(path);
  const mimeByExtension: Record<string, string> = { '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
  return new Blob([content], { type: mimeByExtension[extname(path).toLowerCase()] ?? 'application/octet-stream' });
}

async function projectCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[1], 'project command');
  switch (action) {
    case 'list': requireNoExtraPositionals(args, 2); return client.listProjects();
    case 'get': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const project = (await client.listProjects()).find((item) => item.id === id || item.prefix === id);
      if (!project) throw new CliError(`Project not found: ${id}`, 1);
      return project;
    }
    case 'create': {
      requireNoExtraPositionals(args, 2); const name = flag(args, 'name', true);
      return client.createProject({ name: name!, prefix: flag(args, 'prefix'), workspacePath: flag(args, 'workspace-path'), labels: labelsFlag(args), readme: flag(args, 'readme') });
    }
    case 'update': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const fields = projectFields(args, true); if (Object.keys(fields).length === 1) throw new CliError('At least one project field is required');
      return client.updateProject(id, fields as Parameters<TaskClient['updateProject']>[1]);
    }
    case 'readme': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      const body = flag(args, 'body', true); const version = numberFlag(args, 'version', true);
      return client.updateProject(id, { version: version!, readme: body! });
    }
    case 'delete': {
      const id = positional(args.positionals[2], 'project id'); requireNoExtraPositionals(args, 3);
      await client.deleteProject(id, numberFlag(args, 'version', true)!); return { ok: true, deleted: id };
    }
    default: throw new CliError(`Unknown project command: ${action}`);
  }
}

async function taskCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[1], 'task command');
  switch (action) {
    case 'list': {
      requireNoExtraPositionals(args, 2); const archived = flag(args, 'archived');
      if (archived !== undefined && archived !== 'true' && archived !== 'false' && archived !== 'all') throw new CliError('--archived must be false, true, or all');
      return (await client.listTasks({ projectId: flagAlias(args, ['project', 'project-id']), status: flag(args, 'status'), search: flag(args, 'search'), archived: archived as boolean | 'all' | undefined })).map(taskSummary);
    }
    case 'get': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.getTask(id);
    }
    case 'create': {
      requireNoExtraPositionals(args, 2); const fields = taskFields(args, true); if (!fields.title) throw new CliError('Missing required option: --title'); return client.createTask(fields as TaskInput);
    }
    case 'update': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); const version = numberFlag(args, 'version', true); const fields = taskFields(args, false); if (Object.keys(fields).length === 0) throw new CliError('At least one task field is required'); return client.updateTask(id, { ...fields, version: version! } as TaskPatch);
    }
    case 'archive': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.archiveTask(id, numberFlag(args, 'version', true)!);
    }
    case 'restore': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); return client.restoreTask(id, numberFlag(args, 'version', true)!);
    }
    case 'delete': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); await client.deleteTask(id, numberFlag(args, 'version', true)!); return { ok: true, deleted: id };
    }
    case 'tree': {
      const id = positional(args.positionals[2], 'task id'); requireNoExtraPositionals(args, 3); const direction = enumFlag(args, 'direction', ['ancestors', 'descendants'] as const) ?? 'descendants'; const depth = boundedNumberFlag(args, 'depth', 0, 20) ?? 5; return client.tree(id, direction, depth);
    }
    case 'comments': return commentCommand(args, client);
    case 'relations': return relationCommand(args, client);
    case 'attachments': return attachmentCommand(args, client);
    case 'sessions': return sessionCommand(args, client);
    default: throw new CliError(`Unknown task command: ${action}`);
  }
}

async function detail(client: TaskClient, taskId: string): Promise<TaskDetail> { return client.getTask(taskId); }

async function commentCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'comment command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).comments; }
    case 'add': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return client.addComment(taskId, flag(args, 'body', true)!); }
    case 'update': { const commentId = positional(args.positionals[3], 'comment id'); requireNoExtraPositionals(args, 4); return client.updateComment(commentId, flag(args, 'body', true)!, numberFlag(args, 'version', true)!); }
    case 'delete': { const commentId = positional(args.positionals[3], 'comment id'); requireNoExtraPositionals(args, 4); await client.deleteComment(commentId, numberFlag(args, 'version', true)!); return { ok: true, deleted: commentId }; }
    default: throw new CliError(`Unknown comment command: ${action}`);
  }
}

async function relationCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'relation command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).relations; }
    case 'add': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const type = enumFlag(args, 'type', ['parent', 'blocks', 'related'] as const); if (!type) throw new CliError('Missing required option: --type'); return client.addRelation(taskId, flag(args, 'target', true)!, type, numberFlag(args, 'version', true)!); }
    case 'remove': { const relationId = positional(args.positionals[3], 'relation id'); requireNoExtraPositionals(args, 4); await client.removeRelation(relationId, flag(args, 'task', true)!, numberFlag(args, 'version', true)!); return { ok: true, deleted: relationId }; }
    default: throw new CliError(`Unknown relation command: ${action}`);
  }
}

async function attachmentCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const action = positional(args.positionals[2], 'attachment command');
  switch (action) {
    case 'list': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); return (await detail(client, taskId)).attachments; }
    case 'upload': { const taskId = positional(args.positionals[3], 'task id'); requireNoExtraPositionals(args, 4); const path = flag(args, 'file', true)!; return client.uploadAttachment(taskId, await readInputFile(path), basename(path), flag(args, 'comment')); }
    case 'download': {
      const attachmentId = positional(args.positionals[3], 'attachment id'); requireNoExtraPositionals(args, 4); const path = flag(args, 'output', true)!; await writeFile(resolve(path), await client.downloadAttachment(attachmentId)); return { ok: true, attachmentId, output: resolve(path) };
    }
    case 'delete': { const attachmentId = positional(args.positionals[3], 'attachment id'); requireNoExtraPositionals(args, 4); await client.deleteAttachment(attachmentId); return { ok: true, deleted: attachmentId }; }
    default: throw new CliError(`Unknown attachment command: ${action}`);
  }
}

async function sessionCommand(args: ParsedArgs, client: TaskClient): Promise<unknown> {
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

async function execute(args: ParsedArgs, client: TaskClient): Promise<unknown> {
  const resource = positional(args.positionals[0], 'resource');
  if (resource === 'projects' || resource === 'project') return projectCommand(args, client);
  if (resource === 'tasks' || resource === 'task') return taskCommand(args, client);
  throw new CliError(`Unknown resource: ${resource}`);
}

export async function runCli(argv: string[], client = new TaskClient({ baseUrl: process.env.TASKMANAGER_URL || DEFAULT_TASKMANAGER_URL, actor: process.env.TASKMANAGER_ACTOR || 'taskctl' }), io: Output = process): Promise<number> {
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
