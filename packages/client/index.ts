import type { AgentCapabilities, AgentSkill, Automation, AutomationRun, JiraCapabilities, JiraIssue, Project, Task, TaskDetail, Comment, Attachment, ProjectAttachment, Relation, Session, TaskInput, TaskPatch, Snapshot } from '../contracts/index.ts';
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

  bootstrapSession() { return this.transport.bootstrapSession(); }

  attachmentUrl(attachmentId: string): string { return this.transport.attachmentUrl(attachmentId); }
  request<T>(path: string, method = 'GET', body?: unknown): Promise<T> { return this.transport.request<T>(path, method, body); }

  snapshot() { return this.request<Snapshot>('/api/v1/snapshot'); }
  async listProjects() { return (await this.request<{ items: Project[] }>('/api/v1/projects')).items; }
  async createProject(input: { name: string; prefix?: string; workspacePath?: string | null; labels?: string[]; readme?: string }) { return (await this.request<{ item: Project }>('/api/v1/projects', 'POST', input)).item; }
  async updateProject(projectId: string, input: Partial<Pick<Project, 'name' | 'workspacePath' | 'labels' | 'readme'>> & { version: number }) { expectedVersion(input.version); return (await this.request<{ item: Project }>(`/api/v1/projects/${id(projectId)}`, 'PATCH', input)).item; }
  deleteProject(projectId: string, version: number) { return this.request<void>(`/api/v1/projects/${id(projectId)}?version=${expectedVersion(version)}`, 'DELETE'); }

  async listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: boolean | 'all' } = {}) { return (await this.listTasksPage(filters)).items; }
  async listTasksPage(filters: { projectId?: string; status?: string; search?: string; archived?: boolean | 'all'; cursor?: string; limit?: number } = {}) { const q = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined) q.set(key, String(value)); return this.request<{ items: Task[]; nextCursor: string | null }>(`/api/v1/tasks${q.size ? `?${q}` : ''}`); }
  async getTask(taskId: string) { return (await this.request<{ item: TaskDetail }>(`/api/v1/tasks/${id(taskId)}`)).item; }
  async createTask(input: TaskInput) { return (await this.request<{ item: Task }>('/api/v1/tasks', 'POST', input)).item; }
  async updateTask(taskId: string, input: TaskPatch) { expectedVersion(input.version); return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}`, 'PATCH', input)).item; }
  async copyTask(taskId: string, input: { version: number; projectId?: string; title?: string }) { expectedVersion(input.version); return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}/copy`, 'POST', input)).item; }
  completeTask(taskId: string, version: number) { return this.request<{ task: Task; nextTask: Task | null }>(`/api/v1/tasks/${id(taskId)}/complete`, 'POST', { version: expectedVersion(version) }); }
  archiveTask(taskId: string, version: number) { return this.updateTask(taskId, { version, archivedAt: new Date().toISOString() }); }
  restoreTask(taskId: string, version: number) { return this.updateTask(taskId, { version, archivedAt: null }); }
  deleteTask(taskId: string, version: number) { return this.request<void>(`/api/v1/tasks/${id(taskId)}?version=${expectedVersion(version)}`, 'DELETE'); }

  async addComment(taskId: string, body: string) { return (await this.request<{ item: Comment }>(`/api/v1/tasks/${id(taskId)}/comments`, 'POST', { body })).item; }
  listCommentsPage(taskId: string, cursor?: string, limit?: number) { const q = new URLSearchParams(); if (cursor) q.set('cursor', cursor); if (limit !== undefined) q.set('limit', String(limit)); return this.request<{ items: Comment[]; nextCursor: string | null }>(`/api/v1/tasks/${id(taskId)}/comments${q.size ? `?${q}` : ''}`); }
  listActivitiesPage(taskId: string, cursor?: string, limit?: number) { const q = new URLSearchParams(); if (cursor) q.set('cursor', cursor); if (limit !== undefined) q.set('limit', String(limit)); return this.request<{ items: import('../contracts/index.ts').Activity[]; nextCursor: string | null }>(`/api/v1/tasks/${id(taskId)}/activities${q.size ? `?${q}` : ''}`); }
  async updateComment(commentId: string, body: string, version: number) { return (await this.request<{ item: Comment }>(`/api/v1/comments/${id(commentId)}`, 'PATCH', { body, version: expectedVersion(version) })).item; }
  deleteComment(commentId: string, version: number) { return this.request<void>(`/api/v1/comments/${id(commentId)}?version=${expectedVersion(version)}`, 'DELETE'); }
  async uploadAttachment(taskId: string, file: Blob, filename: string, commentId?: string) { const form = new FormData(); form.set('file', file, filename); if (commentId) form.set('commentId', commentId); return (await this.request<{ item: Attachment }>(`/api/v1/tasks/${id(taskId)}/attachments`, 'POST', form)).item; }
  downloadAttachment(attachmentId: string) { return this.transport.download(`/api/v1/attachments/${id(attachmentId)}`); }
  deleteAttachment(attachmentId: string) { return this.request<void>(`/api/v1/attachments/${id(attachmentId)}`, 'DELETE'); }
  async listProjectAttachments(projectId: string) { return (await this.request<{ items: ProjectAttachment[] }>(`/api/v1/projects/${id(projectId)}/attachments`)).items; }
  async uploadProjectAttachment(projectId: string, file: Blob, filename: string) { const form = new FormData(); form.set('file', file, filename); return (await this.request<{ item: ProjectAttachment }>(`/api/v1/projects/${id(projectId)}/attachments`, 'POST', form)).item; }
  projectAttachmentUrl(attachmentId: string) { return this.transport.baseUrl + `/api/v1/project-attachments/${id(attachmentId)}`; }
  deleteProjectAttachment(attachmentId: string) { return this.request<void>(`/api/v1/project-attachments/${id(attachmentId)}`, 'DELETE'); }
  async addRelation(taskId: string, targetId: string, type: Relation['type'], version: number) { return (await this.request<{ item: Relation }>(`/api/v1/tasks/${id(taskId)}/relations`, 'POST', { targetId, type, version: expectedVersion(version) })).item; }
  removeRelation(relationId: string, taskId: string, version: number) { return this.request<void>(`/api/v1/relations/${id(relationId)}?taskId=${id(taskId)}&version=${expectedVersion(version)}`, 'DELETE'); }
  async addSession(taskId: string, input: Omit<Session, 'id'> & { version: number }) { expectedVersion(input.version); return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}/sessions`, 'POST', input)).item; }
  async removeSession(taskId: string, sessionId: string, version: number) { return (await this.request<{ item: Task }>(`/api/v1/tasks/${id(taskId)}/sessions/${id(sessionId)}?version=${expectedVersion(version)}`, 'DELETE')).item; }

  async tree(taskId: string, direction: 'ancestors' | 'descendants' = 'descendants', depth = 5) {
    if (!Number.isInteger(depth) || depth < 0 || depth > 20) throw new Error('depth must be an integer from 0 to 20');
    return this.request<{ nodes: Task[]; relations: Relation[] }>(`/api/v1/tasks/${id(taskId)}/tree?direction=${direction}&depth=${depth}`);
  }
  startAgentRun(input: { sessionId: string; command: string; args?: string[]; cwd?: string; model?: string; permissionMode?: 'read' | 'write' | 'full'; skillIds?: string[]; input?: string }) { return this.request<{ item: unknown }>(`/api/v1/agent/runs`, 'POST', input).then((response) => response.item); }
  getAgentRun(runId: string) { return this.request<{ item: unknown }>(`/api/v1/agent/runs/${id(runId)}`).then((response) => response.item); }
  agentEvents(runId: string, after = 0) { return this.request<{ items: unknown[]; nextCursor: number }>(`/api/v1/agent/runs/${id(runId)}/events?after=${after}`); }
  agentEventsUrl(runId: string, after = 0): string { return `${this.transport.baseUrl}/api/v1/agent/runs/${id(runId)}/events/stream?after=${after}`; }
  cancelAgentRun(runId: string) { return this.request<{ item: unknown }>(`/api/v1/agent/runs/${id(runId)}/cancel`, 'POST').then((response) => response.item); }
  continueAgentRun(runId: string, input?: string) { return this.request<{ item: unknown }>(`/api/v1/agent/runs/${id(runId)}/continue`, 'POST', { input }).then((response) => response.item); }
  listAgentSkills() { return this.request<{ items: AgentSkill[] }>('/api/v1/agent/skills').then((response) => response.items); }
  agentCapabilities() { return this.request<AgentCapabilities>('/api/v1/agent/capabilities'); }
  automationCapabilities() { return this.request<{ scheduler: string; quota: { status: 'unknown'; reason: string } }>('/api/v1/automations/capabilities'); }
  listAutomations(projectId?: string) { return this.request<{ items: Automation[] }>(`/api/v1/automations${projectId ? `?projectId=${id(projectId)}` : ''}`).then((response) => response.items); }
  createAutomation(input: Omit<Automation, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'nextRunAt'> & { nextRunAt?: string }) { return this.request<{ item: Automation }>('/api/v1/automations', 'POST', input).then((response) => response.item); }
  updateAutomation(automationId: string, input: Partial<Omit<Automation, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> & { version: number }) { expectedVersion(input.version); return this.request<{ item: Automation }>(`/api/v1/automations/${id(automationId)}`, 'PATCH', input).then((response) => response.item); }
  deleteAutomation(automationId: string, version: number) { return this.request<void>(`/api/v1/automations/${id(automationId)}?version=${expectedVersion(version)}`, 'DELETE'); }
  runAutomation(automationId: string) { return this.request<{ item: AutomationRun | null }>(`/api/v1/automations/${id(automationId)}/run`, 'POST').then((response) => response.item); }
  listAutomationRuns(automationId: string) { return this.request<{ items: AutomationRun[] }>(`/api/v1/automations/${id(automationId)}/runs`).then((response) => response.items); }
  jiraCapabilities() { return this.request<JiraCapabilities>('/api/v1/integrations/jira/capabilities'); }
  jiraTestConnection() { return this.request<{ item: { displayName: string | null; accountId: string | null } }>('/api/v1/integrations/jira/test', 'POST').then((response) => response.item); }
  jiraIssue(key: string) { return this.request<{ item: JiraIssue }>(`/api/v1/integrations/jira/issues/${id(key)}`).then((response) => response.item); }
}
