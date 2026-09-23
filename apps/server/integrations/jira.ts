import { Buffer } from 'node:buffer';
import type { JiraCapabilities, JiraIssue } from '../../../packages/contracts/index.ts';

export class JiraError extends Error {
  constructor(readonly code: 'JIRA_NOT_CONFIGURED' | 'JIRA_CONNECTION_FAILED' | 'JIRA_INVALID_RESPONSE', message: string, readonly status = code === 'JIRA_NOT_CONFIGURED' ? 409 : 502) { super(message); this.name = 'JiraError'; }
}

export interface JiraAdapterOptions { baseUrl?: string; email?: string; apiToken?: string; projectKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch; }

type JiraFields = { summary?: unknown; description?: unknown; status?: { name?: unknown }; priority?: { name?: unknown } | null; labels?: unknown; assignee?: { displayName?: unknown; accountId?: unknown } | null; duedate?: unknown; project?: { key?: unknown } };

export class JiraAdapter {
  private readonly baseUrl: string | null;
  private readonly email: string | null;
  private readonly apiToken: string | null;
  private readonly projectKey: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JiraAdapterOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.TASKMANAGER_JIRA_BASE_URL);
    this.email = options.email ?? process.env.TASKMANAGER_JIRA_EMAIL ?? null;
    this.apiToken = options.apiToken ?? process.env.TASKMANAGER_JIRA_API_TOKEN ?? null;
    const configuredProjectKey = options.projectKey !== undefined ? options.projectKey : process.env.TASKMANAGER_JIRA_PROJECT_KEY;
    this.projectKey = configuredProjectKey?.trim() || null;
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 8000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  capabilities(): JiraCapabilities { const configured = !!this.baseUrl && !!this.email && !!this.apiToken; return { configured, baseUrl: this.baseUrl, projectKey: this.projectKey, canRead: configured, canWrite: false }; }

  async testConnection(): Promise<{ displayName: string | null; accountId: string | null }> {
    const response = await this.request('/rest/api/3/myself');
    const body = await readJson(response);
    return { displayName: typeof body.displayName === 'string' ? body.displayName : null, accountId: typeof body.accountId === 'string' ? body.accountId : null };
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const normalizedKey = key.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,99}$/.test(normalizedKey)) throw new JiraError('JIRA_INVALID_RESPONSE', 'A Jira issue key is required', 422);
    const response = await this.request(`/rest/api/3/issue/${encodeURIComponent(normalizedKey)}?fields=summary,description,status,priority,labels,assignee,duedate,project`);
    const body = await readJson(response);
    const fields = body.fields as JiraFields | undefined;
    if (!fields || typeof fields.summary !== 'string' || typeof fields.status?.name !== 'string') throw new JiraError('JIRA_INVALID_RESPONSE', 'Jira returned an unsupported issue shape');
    return { key: normalizedKey, summary: fields.summary, description: adfText(fields.description), status: fields.status.name, priority: typeof fields.priority?.name === 'string' ? fields.priority.name : null, labels: Array.isArray(fields.labels) ? fields.labels.filter((value): value is string => typeof value === 'string') : [], assignee: typeof fields.assignee?.displayName === 'string' ? fields.assignee.displayName : null, dueDate: typeof fields.duedate === 'string' ? fields.duedate : null, projectKey: typeof fields.project?.key === 'string' ? fields.project.key : null, url: `${this.baseUrl}/browse/${encodeURIComponent(normalizedKey)}` };
  }

  private async request(path: string): Promise<Response> {
    if (!this.baseUrl || !this.email || !this.apiToken) throw new JiraError('JIRA_NOT_CONFIGURED', 'Jira credentials are not configured for this instance');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); timer.unref?.();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}` }, signal: controller.signal });
      if (!response.ok) throw new JiraError('JIRA_CONNECTION_FAILED', `Jira request failed with HTTP ${response.status}`, response.status === 401 || response.status === 403 ? 502 : 502);
      return response;
    } catch (error) {
      if (error instanceof JiraError) throw error;
      throw new JiraError('JIRA_CONNECTION_FAILED', error instanceof Error ? error.message : 'Jira request failed');
    } finally { clearTimeout(timer); }
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> { try { const body = await response.json() as unknown; if (!body || typeof body !== 'object') throw new Error('response is not an object'); return body as Record<string, unknown>; } catch { throw new JiraError('JIRA_INVALID_RESPONSE', 'Jira returned invalid JSON'); } }
function normalizeBaseUrl(value: string | undefined): string | null { if (!value?.trim()) return null; try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) return null; url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, ''); } catch { return null; } }
function adfText(value: unknown): string { if (typeof value === 'string') return value; if (!value || typeof value !== 'object') return ''; const node = value as { text?: unknown; content?: unknown[] }; if (typeof node.text === 'string') return node.text; return Array.isArray(node.content) ? node.content.map(adfText).filter(Boolean).join(node.content.some((item) => (item as { type?: unknown })?.type === 'paragraph') ? '\n\n' : '') : ''; }
