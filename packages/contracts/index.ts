export const statuses = ['backlog','todo','in_progress','in_review','blocked','done','canceled'] as const;
export const priorities = ['none','urgent','high','medium','low'] as const;
export type Status = typeof statuses[number];
export type Priority = typeof priorities[number];
export type Platform = 'codex'|'claude'|'pi'|'agy'|'grok';
export interface Session { id:string; platform:Platform; sessionId:string; projectId?:string; hostId?:string; workspacePath?:string; projectKind?:'local'|'remote'; }
export interface Project { id:string; name:string; prefix:string; workspacePath:string|null; labels:string[]; readme:string; version:number; createdAt:string; updatedAt:string; taskCount:number; }
export interface Task { id:string; identifier:string; projectId:string; title:string; description:string; status:Status; priority:Priority; labels:string[]; assignee:string; creator:string; sortOrder:number; startDate:string|null; dueDate:string|null; recurrence:{interval:number;unit:'day'|'week'|'month'|'year'}|null; developmentContext:{type:'branch'|'worktree';branch?:string;path?:string}|null; archivedAt:string|null; version:number; createdAt:string; updatedAt:string; sessions:Session[]; }
export interface Comment { id:string; taskId:string; body:string; author:string; version:number; createdAt:string; updatedAt:string; }
export interface Activity { id:string; taskId:string; actor:string; action:string; changes:Record<string,{before:unknown;after:unknown}>; createdAt:string; }
export interface Attachment { id:string; taskId:string; commentId:string|null; filename:string; contentType:string; size:number; createdAt:string; }
export interface Relation { id:string; sourceId:string; targetId:string; type:'parent'|'blocks'|'related'; }
export interface TaskDetail { task:Task; comments:Comment[]; activities:Activity[]; attachments:Attachment[]; relations:Relation[]; }
export interface Snapshot { projects:Project[]; tasks:Task[]; revision:number; }
export type TaskInput = Pick<Task,'projectId'|'title'> & Partial<Omit<Task,'id'|'identifier'|'version'|'createdAt'|'updatedAt'|'sessions'|'creator'>>;
export type TaskPatch = Partial<TaskInput> & { version:number };
export interface HostContext { host:'standalone'|'codex'|'claude'; workspacePath?:string; sessionId?:string; theme?:'light'|'dark'; }
export const statusLabels:Record<Status,string> = {backlog:'待规划',todo:'待办',in_progress:'进行中',in_review:'待验收',blocked:'阻塞',done:'已完成',canceled:'已取消'};
export const priorityLabels:Record<Priority,string> = {none:'无优先级',urgent:'紧急',high:'高',medium:'中',low:'低'};
