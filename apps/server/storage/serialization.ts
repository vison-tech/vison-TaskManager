import type { DatabaseSync } from 'node:sqlite';
import type { Activity, Attachment, Comment, Project, ProjectAttachment, Relation, Session, Task } from '../../../packages/contracts/index.ts';

export type Row = Record<string, unknown>;

export function iso() { return new Date().toISOString(); }
export function json<T>(value: T) { return JSON.stringify(value); }
export function parse<T>(value: unknown, fallback: T): T { return typeof value === 'string' && value ? JSON.parse(value) as T : fallback; }
export function nullable(value: unknown) { return value === null || value === undefined ? null : String(value); }

export function project(row: Row): Project { return { id: String(row.id), name: String(row.name), prefix: String(row.prefix), workspacePath: nullable(row.workspace_path), labels: parse(row.labels, []), readme: String(row.readme ?? ''), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), taskCount: Number(row.task_count ?? 0) }; }
export function session(row: Row): Session { return { id: String(row.id), platform: row.platform as Session['platform'], sessionId: String(row.session_id), ...(row.project_id ? { projectId: String(row.project_id) } : {}), ...(row.host_id ? { hostId: String(row.host_id) } : {}), ...(row.workspace_path ? { workspacePath: String(row.workspace_path) } : {}), ...(row.project_kind ? { projectKind: row.project_kind as Session['projectKind'] } : {}) }; }
export function task(db: DatabaseSync, row: Row): Task {
  const sessions = db.prepare('SELECT * FROM sessions WHERE task_id = ? ORDER BY created_at, id').all(String(row.id)).map((value) => session(value as Row));
  return { id: String(row.id), identifier: String(row.identifier), projectId: String(row.project_id), title: String(row.title), description: String(row.description), status: row.status as Task['status'], priority: row.priority as Task['priority'], labels: parse(row.labels, []), assignee: String(row.assignee), creator: String(row.creator), sortOrder: Number(row.sort_order), startDate: nullable(row.start_date), dueDate: nullable(row.due_date), recurrence: parse(row.recurrence, null), developmentContext: parse(row.development_context, null), archivedAt: nullable(row.archived_at), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), sessions };
}
export function comment(row: Row): Comment { return { id: String(row.id), taskId: String(row.task_id), body: String(row.body), author: String(row.author), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
export function activity(row: Row): Activity { return { id: String(row.id), taskId: String(row.task_id), actor: String(row.actor), action: String(row.action), changes: parse(row.changes, {}), createdAt: String(row.created_at) }; }
export function attachment(row: Row): Attachment { return { id: String(row.id), taskId: String(row.task_id), commentId: nullable(row.comment_id), filename: String(row.filename), contentType: String(row.content_type), size: Number(row.size), createdAt: String(row.created_at) }; }
export function projectAttachment(row: Row): ProjectAttachment { return { id: String(row.id), projectId: String(row.project_id), filename: String(row.filename), contentType: String(row.content_type), size: Number(row.size), createdAt: String(row.created_at) }; }
export function relation(row: Row): Relation { return { id: String(row.id), sourceId: String(row.source_id), targetId: String(row.target_id), type: row.type as Relation['type'] }; }
