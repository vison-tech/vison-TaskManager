import { assertLocalTaskboardUrl } from './codex.ts';

/** Check both endpoints: a healthy API alone cannot render the embedded task board. */
export async function assertTaskboardReady(url: string, request: typeof fetch = fetch, accessToken?: string): Promise<void> {
  const origin = assertLocalTaskboardUrl(url);
  const read = (path: string) => request(`${origin}${path}`, { signal: AbortSignal.timeout(3000), redirect: 'error', ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}) }).catch(() => null);
  const [api, page] = await Promise.all([read('/api/v1/meta'), read('/')]);
  const apiStatus = api?.status;
  const pageReady = page?.ok && page.headers.get('content-type')?.includes('text/html');
  await Promise.all([api?.body?.cancel(), page?.body?.cancel()]);
  if (apiStatus === 401 || apiStatus === 403) throw new Error('Taskboard requires authorization; configure the same TASKMANAGER_ACCESS_TOKEN for the service and injector.');
  if (!api?.ok) throw new Error(`Taskboard API is not reachable at ${origin}; start the local service first.`);
  if (!pageReady) throw new Error(`Taskboard Web is not available at ${origin}; run npm run build and restart the local service, or use a running Web URL.`);
}
