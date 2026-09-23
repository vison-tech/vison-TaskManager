import { z } from 'zod';
import type { TaskInput, TaskPatch } from '../../../packages/contracts/index.ts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTaskClient } from '../client.ts';
import { detailSummary, result, taskSummary } from '../format.ts';
import { date, defined, developmentContext, priority, recurrence, status } from '../schema.ts';

export function registerTaskTools(server: McpServer, client: McpTaskClient): void {
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
      startDate: date.nullable().optional(),
      dueDate: date.nullable().optional(),
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
      startDate: date.nullable().optional(),
      dueDate: date.nullable().optional(),
      recurrence: recurrence.nullable().optional(),
      developmentContext: developmentContext.nullable().optional(),
      archivedAt: z.string().datetime({ offset: true }).nullable().optional(),
    },
  }, async ({ taskId, ...input }) => {
    const task = await client.updateTask(taskId, defined(input) as TaskPatch);
    return result(taskSummary(task));
  });

  server.registerTool('complete_task', {
    title: 'Complete task',
    description: 'Complete a task with optimistic concurrency. Recurring tasks return the next task when one is generated.',
    inputSchema: { taskId: z.string().min(1).describe('Task id or human identifier'), version: z.number().int().positive().describe('Current task version') },
  }, async ({ taskId, version }) => {
    const completed = await client.completeTask(taskId, version);
    return result({ task: taskSummary(completed.task), nextTask: completed.nextTask ? taskSummary(completed.nextTask) : null });
  });

}

export function registerTaskTreeTool(server: McpServer, client: McpTaskClient): void {
  server.registerTool('task_tree', {
    title: 'Get task tree',
    description: 'Read parent ancestors or descendants with a bounded depth.',
    inputSchema: { taskId: z.string().min(1), direction: z.enum(['ancestors', 'descendants']).optional(), depth: z.number().int().min(0).max(20).optional() },
  }, async ({ taskId, direction = 'descendants', depth = 5 }) => {
    const tree = await client.tree(taskId, direction, depth);
    return result({ nodes: tree.nodes.map(taskSummary), relations: tree.relations });
  });
}
