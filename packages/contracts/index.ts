export { priorities, projectKinds, relationTypes, statuses, platforms } from './values.ts';
export type { Priority, ProjectKind, RelationType, Status, Platform } from './values.ts';
import type { Priority, ProjectKind, RelationType, Status, Platform } from './values.ts';
export type ActorType = 'user' | 'agent' | 'system';
export interface Actor { type: ActorType; id: string; name?: string; avatar?: string; }
export interface SessionRef { platform: Platform; sessionId: string; projectId?: string; hostId?: string; workspacePath?: string; projectKind?: ProjectKind; }
export type AttachmentOwner = { type: 'task' | 'comment' | 'project'; id: string };
export type ExpectedVersion = number;
export interface ApiError { error: { code: string; message: string; details?: unknown; requestId: string; } }
export interface RevisionEvent { protocolVersion: '1'; type: 'revision'; revision: number; resource?: 'project' | 'task' | 'comment' | 'attachment' | 'relation' | 'session' | 'readme'; resourceId?: string; }
export type HostCapability = 'embedPanel' | 'readContext' | 'openConversation' | 'composeDraft' | 'runAgent';
export type HostCapabilityState = 'supported' | 'unsupported' | 'unavailable';
export interface HostCapabilityInfo { state: HostCapabilityState; reason?: string; }
export type HostCapabilities = Record<HostCapability, HostCapabilityInfo>;
export interface HostBridgeMessage { protocolVersion: '1'; requestId: string; type: 'hello' | 'capabilities' | 'context' | 'openConversation' | 'composeDraft' | 'response' | 'error'; payload: unknown; }
export interface Session extends SessionRef { id:string; }
export interface AgentSkill { id: string; name: string; description: string; }
export interface AgentCapabilities { commands: string[]; models: string[]; permissionModes: Array<'read' | 'write' | 'full'>; skills: AgentSkill[]; }
export type AutomationRunStatus = 'started' | 'completed' | 'failed' | 'skipped';
export interface Automation { id: string; projectId: string; name: string; enabled: boolean; intervalSeconds: number; command: string; sessionId: string; input: string; model?: string; permissionMode: 'read' | 'write' | 'full'; skillIds: string[]; nextRunAt: string; version: number; createdAt: string; updatedAt: string; }
export interface AutomationRun { id: string; automationId: string; triggerKey: string; runId: string | null; status: AutomationRunStatus; reason?: string; createdAt: string; finishedAt: string | null; }
export interface JiraCapabilities { configured: boolean; baseUrl: string | null; projectKey: string | null; canRead: boolean; canWrite: boolean; }
export interface JiraIssue { key: string; summary: string; description: string; status: string; priority: string | null; labels: string[]; assignee: string | null; dueDate: string | null; projectKey: string | null; url: string; }
export interface Project { id:string; name:string; prefix:string; workspacePath:string|null; labels:string[]; readme:string; version:number; createdAt:string; updatedAt:string; taskCount:number; }
export interface Task { id:string; identifier:string; projectId:string; title:string; description:string; status:Status; priority:Priority; labels:string[]; assignee:string; creator:string; sortOrder:number; startDate:string|null; dueDate:string|null; recurrence:{interval:number;unit:'day'|'week'|'month'|'year';anchorDate?:string;occurrence?:number}|null; developmentContext:{type:'branch'|'worktree';branch?:string;path?:string}|null; archivedAt:string|null; version:number; createdAt:string; updatedAt:string; sessions:Session[]; }
export interface Comment { id:string; taskId:string; body:string; author:string; version:number; createdAt:string; updatedAt:string; }
export interface Activity { id:string; taskId:string; actor:string; action:string; changes:Record<string,{before:unknown;after:unknown}>; createdAt:string; }
export interface Attachment { id:string; taskId:string; commentId:string|null; filename:string; contentType:string; size:number; createdAt:string; }
export interface ProjectAttachment { id:string; projectId:string; filename:string; contentType:string; size:number; createdAt:string; }
export interface Relation { id:string; sourceId:string; targetId:string; type:RelationType; }
export interface TaskDetail { task:Task; comments:Comment[]; activities:Activity[]; attachments:Attachment[]; relations:Relation[]; }
export interface Snapshot { projects:Project[]; tasks:Task[]; relations?: Relation[]; revision:number; }
export type TaskInput = Pick<Task,'projectId'|'title'> & Partial<Omit<Task,'id'|'identifier'|'version'|'createdAt'|'updatedAt'|'sessions'|'creator'>>;
export type TaskPatch = Partial<TaskInput> & { version:number };
export interface HostContext { host:'standalone'|'codex'|'claude'; workspacePath?:string; sessionId?:string; theme?:'light'|'dark'; }
export const statusLabels:Record<Status,string> = {backlog:'待规划',todo:'待办',in_progress:'进行中',in_review:'待验收',blocked:'阻塞',done:'已完成',canceled:'已取消'};
export const priorityLabels:Record<Priority,string> = {none:'无优先级',urgent:'紧急',high:'高',medium:'中',low:'低'};

export {
  actor, apiError, attachmentOwner, commentCreate, commentPatch, date, developmentContext,
  hostBridgeMessage, hostCapabilities, hostCapability, hostCapabilityState, labels,
  projectCreate, projectPatch, recurrence, relationCreate, revisionEvent, sessionCreate, taskCopy, taskComplete, agentRunCreate, agentRunContinue,
  sessionRef, taskCreate, taskPatch, automationCreate, automationPatch, version,
} from './schemas.ts';
export type { AutomationCreateInput, AutomationPatchInput, TaskCopyInput, TaskCreateInput, TaskPatchInput, SessionCreateInput } from './schemas.ts';
