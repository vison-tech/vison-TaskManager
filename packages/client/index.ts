import type { Project, Task, TaskDetail, Comment, Attachment, Relation, Session, TaskInput, TaskPatch, Snapshot } from '../contracts/index.ts';
import { DEFAULT_TASKMANAGER_URL, expectedVersion, HttpTransport } from './transport.ts';
import type { TaskClientOptions } from './transport.ts';

export { DEFAULT_TASKMANAGER_URL, ApiError, expectedVersion, HttpTransport } from './transport.ts';
export type { TaskClientOptions } from './transport.ts';

const id = encodeURIComponent;

export class TaskClient {
  private readonly transport: HttpTransport;

  constructor(options: TaskClientOptions = {}) {
    this.transport = new HttpTransport(options);
  }

  get baseUrl(): string { return this.transport.baseUrl; }
  get actor(): string { return this.transport.actor; }
  get timeoutMs(): number { return this.transport.timeoutMs; }

  attachmentUrl(attachmentId: string): string { return this.transport.attachmentUrl(attachmentId); }
  request<T>(path: string, method = 'GET', body?: unknown): Promise<T> { return this.transport.request<T>(path, method, body); }

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
  downloadAttachment(attachmentId: string) { return this.transport.download(`/api/v1/attachments/${id(attachmentId)}`); }
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
