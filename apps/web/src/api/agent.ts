import { client } from './client';

export const agentApi = {
  agentCapabilities: () => client.agentCapabilities(),
  agentCatalog: () => client.agentCatalog(),
  listAgentThreads: (filters: { projectId?: string; taskId?: string; limit?: number } = {}) => client.listAgentThreads(filters),
  createAgentThread: (input: Parameters<typeof client.createAgentThread>[0]) => client.createAgentThread(input),
  getAgentThread: (threadId: string) => client.getAgentThread(threadId),
  agentMessagesPage: (threadId: string, options: { after?: number; before?: number; limit?: number } = {}) => client.agentMessagesPage(threadId, options),
  agentMessagesUrl: (threadId: string, after = 0) => client.agentMessagesUrl(threadId, after),
  agentTurn: (threadId: string, input: Parameters<typeof client.agentTurn>[1]) => client.agentTurn(threadId, input),
  agentEvents: (runId: string, after = 0) => client.agentEvents(runId, after),
  agentEventsUrl: (runId: string, after = 0) => client.agentEventsUrl(runId, after),
  getAgentRun: (runId: string) => client.getAgentRun(runId),
  startAgentRun: (input: { sessionId: string; command: string; model?: string; permissionMode?: 'read' | 'write' | 'full'; skillIds?: string[]; input?: string }) => client.startAgentRun(input),
  cancelAgentRun: (runId: string) => client.cancelAgentRun(runId),
  continueAgentRun: (runId: string, input?: string) => client.continueAgentRun(runId, input),
};
