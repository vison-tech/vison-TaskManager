import { collaborationApi } from './api/collaboration';
import { ApiError } from './api/client';
import { projectApi } from './api/projects';
import { taskApi } from './api/tasks';

export { ApiError };

export const api = { ...projectApi, ...taskApi, ...collaborationApi };
