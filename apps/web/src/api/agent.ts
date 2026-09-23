import { client } from './client';

export const agentApi = {
  agentCapabilities: () => client.agentCapabilities(),
  agentEvents: (runId: string, after = 0) => client.agentEvents(runId, after),
  agentEventsUrl: (runId: string, after = 0) => client.agentEventsUrl(runId, after),
  getAgentRun: (runId: string) => client.getAgentRun(runId),
  startAgentRun: (input: { sessionId: string; command: string; model?: string; permissionMode?: 'read' | 'write' | 'full'; skillIds?: string[]; input?: string }) => client.startAgentRun(input),
  cancelAgentRun: (runId: string) => client.cancelAgentRun(runId),
  continueAgentRun: (runId: string, input?: string) => client.continueAgentRun(runId, input),
};
