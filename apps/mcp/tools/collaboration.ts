import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Relation, Session } from '../../../packages/contracts/index.ts';
import type { McpTaskClient } from '../client.ts';
import { result, taskSummary } from '../format.ts';

export function registerCollaborationTools(server: McpServer, client: McpTaskClient): void {
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
}
