import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { priorities, statusLabels, statuses, type Relation, type Session, type Task, type TaskDetail, type TaskInput, type TaskPatch } from '../../packages/contracts/index.ts';
import { DEFAULT_TASKMANAGER_URL, TaskClient } from '../../packages/client/index.ts';

const status = z.enum(statuses);
const priority = z.enum(priorities);
const recurrence = z.object({ interval: z.number().int().min(1).max(1000), unit: z.enum(['day', 'week', 'month', 'year']) });
const developmentContext = z.object({ type: z.enum(['branch', 'worktree']), branch: z.string().max(4096).optional(), path: z.string().max(4096).optional() });

export interface McpTaskClient {
  listProjects(): Promise<unknown[]>;
  listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: boolean | 'all' }): Promise<Task[]>;
  getTask(taskId: string): Promise<TaskDetail>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(taskId: string, input: TaskPatch): Promise<Task>;
  addComment(taskId: string, body: string): Promise<unknown>;
  addRelation(taskId: string, targetId: string, type: Relation['type'], version: number): Promise<unknown>;
  addSession(taskId: string, input: Omit<Session, 'id'> & { version: number }): Promise<Task>;
  tree(taskId: string, direction: 'ancestors' | 'descendants', depth: number): Promise<{ nodes: Task[]; relations: Relation[] }>;
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function taskSummary(task: Task) {
  return { id: task.id, identifier: task.identifier, projectId: task.projectId, title: task.title, status: task.status, statusLabel: statusLabels[task.status], priority: task.priority, labels: task.labels, assignee: task.assignee, dueDate: task.dueDate, archivedAt: task.archivedAt, version: task.version, sessions: task.sessions };
}

function detailSummary(detail: TaskDetail) {
  return { ...taskSummary(detail.task), description: detail.task.description, startDate: detail.task.startDate, recurrence: detail.task.recurrence, comments: detail.comments, activities: detail.activities, attachments: detail.attachments, relations: detail.relations };
}

export function createMcpServer(client: McpTaskClient = new TaskClient({ baseUrl: process.env.TASKMANAGER_URL || DEFAULT_TASKMANAGER_URL, actor: process.env.TASKMANAGER_ACTOR || 'mcp-agent' })) {
  const server = new McpServer({ name: 'taskmanager', version: '0.1.0' });

  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'List TaskManager projects. Use the project id when creating or filtering tasks.',
    inputSchema: {},
  }, async () => result(await client.listProjects()));

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'List tasks with optional project, status, text search, and archive filters.',
    inputSchema: {
      projectId: z.string().min(1).optional().describe('Project id'),
      status: status.optional().describe('Task status'),
      search: z.string().max(500).optional().describe('Search identifier, title, description, or labels'),
      archived: z.union([z.boolean(), z.literal('all')]).optional().describe('false for active tasks, true for archived tasks, all for both'),
    },
  }, async (input) => result((await client.listTasks(input)).map(taskSummary)));

  server.registerTool('get_task', {
    title: 'Get task',
    description: 'Get one task with description, comments, activities, attachments, relations, sessions, and its current version.',
    inputSchema: { taskId: z.string().min(1).describe('Task id or human identifier') },
  }, async ({ taskId }) => result(detailSummary(await client.getTask(taskId))));

  server.registerTool('create_task', {
    title: 'Create task',
    description: 'Create a task in a project. The creator is recorded as the configured MCP actor.',
    inputSchema: {
      projectId: z.string().min(1).describe('Project id'),
      title: z.string().trim().min(1).max(500).describe('Task title'),
      description: z.string().max(1_000_000).optional(),
      status: status.optional(),
      priority: priority.optional(),
      labels: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
      assignee: z.string().max(500).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      recurrence: recurrence.nullable().optional(),
      developmentContext: developmentContext.nullable().optional(),
    },
  }, async (input) => {
    const task = await client.createTask(defined(input) as TaskInput);
    return result(taskSummary(task));
  });

  server.registerTool('update_task', {
    title: 'Update task',
    description: 'Update a task using optimistic concurrency. Always use the current version from get_task or list_tasks; stale writes are rejected.',
    inputSchema: {
      taskId: z.string().min(1).describe('Task id or human identifier'),
      version: z.number().int().positive().describe('Current task version'),
      projectId: z.string().min(1).optional(),
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(1_000_000).optional(),
      status: status.optional(),
      priority: priority.optional(),
      labels: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
      assignee: z.string().max(500).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      recurrence: recurrence.nullable().optional(),
      developmentContext: developmentContext.nullable().optional(),
      archivedAt: z.string().datetime({ offset: true }).nullable().optional(),
    },
  }, async ({ taskId, ...input }) => {
    const task = await client.updateTask(taskId, defined(input) as TaskPatch);
    return result(taskSummary(task));
  });

  server.registerTool('add_comment', {
    title: 'Add comment',
    description: 'Add an auditable progress update to a task as the configured MCP actor.',
    inputSchema: { taskId: z.string().min(1).describe('Task id or human identifier'), body: z.string().trim().min(1).max(1_000_000) },
  }, async ({ taskId, body }) => result(await client.addComment(taskId, body)));

  server.registerTool('add_relation', {
    title: 'Add task relation',
    description: 'Add a parent, blocks, or related relation. Parent relations enforce one parent and reject cycles.',
    inputSchema: { taskId: z.string().min(1), targetId: z.string().min(1), type: z.enum(['parent', 'blocks', 'related']), version: z.number().int().positive().describe('Current source task version') },
  }, async ({ taskId, targetId, type, version }) => result(await client.addRelation(taskId, targetId, type as Relation['type'], version)));

  server.registerTool('link_session', {
    title: 'Link agent session',
    description: 'Link a Codex, Claude, Pi, AGY, or Grok session to a task without replacing other session links.',
    inputSchema: {
      taskId: z.string().min(1), version: z.number().int().positive().describe('Current task version'),
      platform: z.enum(['codex', 'claude', 'pi', 'agy', 'grok']), sessionId: z.string().trim().min(1).max(500),
      projectId: z.string().max(500).optional(), hostId: z.string().max(500).optional(), workspacePath: z.string().max(4096).optional(), projectKind: z.enum(['local', 'remote']).optional(),
    },
  }, async ({ taskId, version, ...input }) => result(taskSummary(await client.addSession(taskId, { ...input, version } as Omit<Session, 'id'> & { version: number }))));

  server.registerTool('task_tree', {
    title: 'Get task tree',
    description: 'Read parent ancestors or descendants with a bounded depth.',
    inputSchema: { taskId: z.string().min(1), direction: z.enum(['ancestors', 'descendants']).optional(), depth: z.number().int().min(0).max(20).optional() },
  }, async ({ taskId, direction = 'descendants', depth = 5 }) => {
    const tree = await client.tree(taskId, direction, depth);
    return result({ nodes: tree.nodes.map(taskSummary), relations: tree.relations });
  });

  return server;
}
