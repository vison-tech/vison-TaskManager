import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_TASKMANAGER_URL, TaskClient } from '../../packages/client/index.ts';
import { createMcpServer } from './server.ts';

const server = createMcpServer(new TaskClient({ baseUrl: process.env.TASKMANAGER_URL || DEFAULT_TASKMANAGER_URL, actor: process.env.TASKMANAGER_ACTOR || 'mcp-agent', accessToken: process.env.TASKMANAGER_ACCESS_TOKEN }));
const transport = new StdioServerTransport();
await server.connect(transport);

const close = () => { void server.close(); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
