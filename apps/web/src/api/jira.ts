import { client } from './client';

export const jiraApi = {
  jiraCapabilities: () => client.jiraCapabilities(),
  jiraTestConnection: () => client.jiraTestConnection(),
  jiraIssue: (key: string) => client.jiraIssue(key),
};
