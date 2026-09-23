import { client } from './client';

export const automationApi = {
  automationCapabilities: () => client.automationCapabilities(),
  listAutomations: (projectId: string) => client.listAutomations(projectId),
  createAutomation: (input: Parameters<typeof client.createAutomation>[0]) => client.createAutomation(input),
  updateAutomation: (automationId: string, input: Parameters<typeof client.updateAutomation>[1]) => client.updateAutomation(automationId, input),
  deleteAutomation: (automationId: string, version: number) => client.deleteAutomation(automationId, version),
  runAutomation: (automationId: string) => client.runAutomation(automationId),
  listAutomationRuns: (automationId: string) => client.listAutomationRuns(automationId),
};
