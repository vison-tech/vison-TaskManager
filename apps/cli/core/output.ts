import type { Task } from '../../../packages/contracts/index.ts';
import type { Output, ParsedArgs } from './types.ts';

export const usage = `TaskManager CLI

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
  tasks complete <task-id> --version <n>
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

export function taskSummary(task: Task) {
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
  if ('identifier' in record && 'title' in record) return `${record.identifier}  ${record.title}  [${record.status}] ${record.priority}  v${record.version}`;
  if ('prefix' in record && 'name' in record) return `${record.prefix}  ${record.id}  ${record.name}  ${record.taskCount ?? 0} tasks  v${record.version}`;
  if ('body' in record && 'author' in record) return `${record.id}  ${record.author}: ${record.body}  v${record.version}`;
  if ('filename' in record && 'size' in record) return `${record.id}  ${record.filename}  ${record.size} bytes`;
  if ('platform' in record && 'sessionId' in record) return `${record.platform}  ${record.sessionId}`;
  return Object.entries(record).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item ?? '')}`).join('\n');
}

export function output(value: unknown, args: ParsedArgs, io: Output): void {
  io.stdout.write(args.json ? `${JSON.stringify(value, null, 2)}\n` : `${humanValue(value)}\n`);
}
