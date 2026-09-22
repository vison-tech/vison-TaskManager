import { ApiError, TaskClient } from '../../../../packages/client/index.ts';

export { ApiError };

export const client = new TaskClient({ baseUrl: '', actor: 'web-user' });
