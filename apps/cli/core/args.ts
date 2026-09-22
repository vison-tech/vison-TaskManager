import { priorities, statuses, type TaskInput } from '../../../packages/contracts/index.ts';
import { CliError, type ParsedArgs } from './types.ts';

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
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
      flags.set(name, value);
      index += 1;
    }
  }
  return { positionals, flags, json: flags.get('json') === true };
}

export function flag(args: ParsedArgs, name: string, required = false): string | undefined {
  const value = args.flags.get(name);
  if (value === true) throw new CliError(`Option requires a value: --${name}`);
  if (required && value === undefined) throw new CliError(`Missing required option: --${name}`);
  return value;
}

export function flagAlias(args: ParsedArgs, names: string[], required = false): string | undefined {
  const present = names.filter((name) => args.flags.has(name));
  if (present.length > 1) throw new CliError(`Options are mutually exclusive: ${present.map((name) => `--${name}`).join(', ')}`);
  return flag(args, present[0] ?? names[0], required);
}

export function positional(value: string | undefined, description: string): string {
  if (!value) throw new CliError(`Missing ${description}`);
  return value;
}

export function requireNoExtraPositionals(args: ParsedArgs, from: number): void {
  if (args.positionals.length > from) throw new CliError(`Unexpected argument: ${args.positionals[from]}`);
}

export function numberFlag(args: ParsedArgs, name: string, required = false): number | undefined {
  const value = flag(args, name, required);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new CliError(`--${name} must be a positive integer`);
  return number;
}

export function boundedNumberFlag(args: ParsedArgs, name: string, minimum: number, maximum: number): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new CliError(`--${name} must be an integer from ${minimum} to ${maximum}`);
  return number;
}

export function finiteNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CliError(`--${name} must be a finite number`);
  return number;
}

export function enumFlag<T extends readonly string[]>(args: ParsedArgs, name: string, values: T): T[number] | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) throw new CliError(`--${name} must be one of: ${values.join(', ')}`);
  return value as T[number];
}

export function jsonFlag<T>(args: ParsedArgs, name: string): T | undefined {
  const value = flag(args, name);
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new CliError(`--${name} must contain valid JSON`);
  }
}

export function labelsFlag(args: ParsedArgs): string[] | undefined {
  const value = flag(args, 'labels');
  return value === undefined ? undefined : [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export function taskFields(args: ParsedArgs, includeProject: boolean): Partial<TaskInput> {
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

export function projectFields(args: ParsedArgs, includeVersion: boolean): { version?: number; name?: string; workspacePath?: string | null; readme?: string; labels?: string[] } {
  const fields: { version?: number; name?: string; workspacePath?: string | null; readme?: string; labels?: string[] } = {};
  if (includeVersion) fields.version = numberFlag(args, 'version', true);
  const name = flag(args, 'name'); if (name !== undefined) fields.name = name;
  const workspacePath = flag(args, 'workspace-path'); if (workspacePath !== undefined) fields.workspacePath = workspacePath;
  const readme = flag(args, 'readme'); if (readme !== undefined) fields.readme = readme;
  const labels = labelsFlag(args); if (labels !== undefined) fields.labels = labels;
  return fields;
}
