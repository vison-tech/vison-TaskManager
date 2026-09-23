import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_TASKMANAGER_URL, TaskClient } from '../../packages/client/index.ts';
import type { McpTaskClient } from './client.ts';
import { registerCollaborationTools } from './tools/collaboration.ts';
import { registerProjectTools } from './tools/projects.ts';
import { registerTaskTools, registerTaskTreeTool } from './tools/tasks.ts';

export type { McpTaskClient } from './client.ts';

export function createMcpServer(client: McpTaskClient = new TaskClient({ baseUrl: process.env.TASKMANAGER_URL || DEFAULT_TASKMANAGER_URL, actor: process.env.TASKMANAGER_ACTOR || 'mcp-agent', accessToken: process.env.TASKMANAGER_ACCESS_TOKEN })) {
  const server = new McpServer({ name: 'taskmanager', version: '0.1.0' });
  registerProjectTools(server, client);
  registerTaskTools(server, client);
  registerCollaborationTools(server, client);
  registerTaskTreeTool(server, client);
  return server;
}
