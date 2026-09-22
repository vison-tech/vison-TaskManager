import type { Project, Task, TaskDetail, Comment, Attachment, Relation, Session, TaskInput, TaskPatch, Snapshot } from '../contracts/index.ts';

export const DEFAULT_TASKMANAGER_URL = 'http://127.0.0.1:47830';

export interface TaskClientOptions {
  baseUrl?: string;
  actor?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

interface ErrorEnvelope { error?: { code?: string; message?: string; details?: unknown; requestId?: string }; }

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown, public readonly requestId?: string, options?: ErrorOptions) {
    super(message, options); this.name = 'ApiError';
  }
}

export function expectedVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('An explicit positive integer version is required');
  return version;
}

const id = encodeURIComponent;

export class TaskClient {
  readonly baseUrl: string;
  readonly actor: string;
  readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: TaskClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_TASKMANAGER_URL).replace(/\/$/, '');
    this.actor = options.actor ?? 'agent';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  private url(path: string): string { return `${this.baseUrl}${path}`; }
  attachmentUrl(attachmentId: string): string { return this.url(`/api/v1/attachments/${id(attachmentId)}`); }

  private async responseError(response: Response): Promise<ApiError> {
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) as ErrorEnvelope | null : null;
    const text = payload ? undefined : await response.text().catch(() => '');
    return new ApiError(response.status, payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? text ?? response.statusText ?? `Request failed (${response.status})`, payload?.error?.details, payload?.error?.requestId);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      // Each operation performs exactly one fetch. In particular, writes are never retried.
      return await this.fetch(this.url(path), { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new ApiError(0, timedOut ? 'REQUEST_TIMEOUT' : 'CONNECTION_ERROR', timedOut ? `Request timed out after ${this.timeoutMs} ms` : 'Unable to reach TaskManager', undefined, undefined, { cause: error });
    }
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const multipart = body instanceof FormData;
    const response = await this.send(path, { method, headers: { 'X-TaskManager-Actor': this.actor, ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    if (!response.ok) throw await this.responseError(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  snapshot() { return this.request<Snapshot>('/api/v1/snapshot'); }
  async listProjects() { return (await this.request<{ items: Project[] }>('/api/v1/projects')).items; }
  async createProject(input: { name: string; prefix?: string; workspacePath?: string | null; labels?: string[]; readme?: string }) { return (await this.request<{ item: Project }>('/api/v1/projects', 'POST', input)).item; }
  async updateProject(projectId: string, input: Partial<Pick<Project, 'name' | 'workspacePath' | 'labels' | 'readme'>> & { version: number }) { expectedVersion(input.version); return (await this.request<{ item: Project }>(`/api/v1/projects/${id(projectId)}`, 'PATCH', input)).item; }
  deleteProject(projectId: string, version: number) { return this.request<void>(`/api/v1/projects/${id(projectId)}?version=${expectedVersion(version)}`, 'DELETE'); }
  async listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: boolean | 'all' } = {}) { const q = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined) q.set(key, String(value)); return (await this.request<{ items: Task[] }>(`/api/v1/tasks${q.size ? `?${q}` : ''}`)).items; }
  async getTask(taskId: string) { return (await this.request<{ item: TaskDetail }>(`/api/v1/tasks/${id(taskId)}`)).item; }
  async createTask(input: TaskInput) { return (await this.request<{ item: Task }>('/api/v1/tasks', 'POST', input)).item; }
  async updateTask(taskId: string, input: TaskPatch) { expectedVersion(input.version); return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}`, 'PATCH', input)).item; }
  archiveTask(taskId: string, version: number) { return this.updateTask(taskId, { version, archivedAt: new Date().toISOString() }); }
  restoreTask(taskId: string, version: number) { return this.updateTask(taskId, { version, archivedAt: null }); }
  deleteTask(taskId: string, version: number) { return this.request<void>(`/api/v1/tasks/${id(taskId)}?version=${expectedVersion(version)}`, 'DELETE'); }
  async addComment(taskId: string, body: string) { return (await this.request<{ item: Comment }>(`/api/v1/tasks/${id(taskId)}/comments`, 'POST', { body })).item; }
  async updateComment(commentId: string, body: string, version: number) { return (await this.request<{ item: Comment }>(`/api/v1/comments/${id(commentId)}`, 'PATCH', { body, version: expectedVersion(version) })).item; }
  deleteComment(commentId: string, version: number) { return this.request<void>(`/api/v1/comments/${id(commentId)}?version=${expectedVersion(version)}`, 'DELETE'); }
  async uploadAttachment(taskId: string, file: Blob, filename: string, commentId?: string) { const form = new FormData(); form.set('file', file, filename); if (commentId) form.set('commentId', commentId); return (await this.request<{ item: Attachment }>(`/api/v1/tasks/${id(taskId)}/attachments`, 'POST', form)).item; }
  async downloadAttachment(attachmentId: string) { const response = await this.send(`/api/v1/attachments/${id(attachmentId)}`, { headers: { 'X-TaskManager-Actor': this.actor } }); if (!response.ok) throw await this.responseError(response); return new Uint8Array(await response.arrayBuffer()); }
  deleteAttachment(attachmentId: string) { return this.request<void>(`/api/v1/attachments/${id(attachmentId)}`, 'DELETE'); }
  async addRelation(taskId: string, targetId: string, type: Relation['type'], version: number) { return (await this.request<{ item: Relation }>(`/api/v1/tasks/${id(taskId)}/relations`, 'POST', { targetId, type, version: expectedVersion(version) })).item; }
  removeRelation(relationId: string, taskId: string, version: number) { return this.request<void>(`/api/v1/relations/${id(relationId)}?taskId=${id(taskId)}&version=${expectedVersion(version)}`, 'DELETE'); }
  async addSession(taskId: string, input: Omit<Session, 'id'> & { version: number }) { expectedVersion(input.version); return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}/sessions`, 'POST', input)).item; }
  async removeSession(taskId: string, sessionId: string, version: number) { return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}/sessions/${id(sessionId)}?version=${expectedVersion(version)}`, 'DELETE')).item; }
  async tree(taskId: string, direction: 'ancestors' | 'descendants' = 'descendants', depth = 5) {
    if (!Number.isInteger(depth) || depth < 0 || depth > 20) throw new Error('depth must be an integer from 0 to 20');
    const seen = new Set<string>(); const nodes: Task[] = []; const edges: Relation[] = [];
    const visit = async (key: string, level: number): Promise<void> => { if (seen.has(key)) return; if (seen.size >= 500) throw new Error('Tree exceeds 500 nodes; reduce depth'); seen.add(key); const detail = await this.getTask(key); nodes.push(detail.task); if (level === depth) return; for (const relation of detail.relations) { if (relation.type !== 'parent') continue; const next = direction === 'descendants' ? (relation.sourceId === key ? relation.targetId : null) : (relation.targetId === key ? relation.sourceId : null); if (next) { edges.push(relation); await visit(next, level + 1); } } };
    await visit(taskId, 0); return { nodes, relations: edges };
  }
}
