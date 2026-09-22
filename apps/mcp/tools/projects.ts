import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTaskClient } from '../client.ts';
import { result } from '../format.ts';

export function registerProjectTools(server: McpServer, client: McpTaskClient): void {
  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'List TaskManager projects. Use the project id when creating or filtering tasks.',
    inputSchema: {},
  }, async () => result(await client.listProjects()));
}
