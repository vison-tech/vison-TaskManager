import { collaborationApi } from './api/collaboration';
import { agentApi } from './api/agent';
import { automationApi } from './api/automations';
import { jiraApi } from './api/jira';
import { ApiError } from './api/client';
import { projectApi } from './api/projects';
import { taskApi } from './api/tasks';

export { ApiError };

export const api = { ...projectApi, ...taskApi, ...collaborationApi, ...agentApi, ...automationApi, ...jiraApi };
