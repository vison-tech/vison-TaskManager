import { ApiError, TaskClient } from '../../../../packages/client/index.ts';
import { webBaseUrl } from '../lib/embedded';

export { ApiError };

export const client = new TaskClient({ baseUrl: webBaseUrl, actor: 'web-user' });
