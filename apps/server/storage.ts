import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Activity, Attachment, Comment, Project, Relation, Session, Task, TaskDetail, TaskInput, TaskPatch } from '../../packages/contracts/index.ts';
import { fail, validateTask } from './validation.ts';

type Actor = string;
type Row = Record<string, unknown>;
function iso() { return new Date().toISOString(); }
function json<T>(value: T) { return JSON.stringify(value); }
function parse<T>(value: unknown, fallback: T): T { return typeof value === 'string' && value ? JSON.parse(value) as T : fallback; }
function nullable(value: unknown) { return value === null || value === undefined ? null : String(value); }

export class Storage {
  readonly db: DatabaseSync;
  readonly subscribers = new Set<(revision: number) => void>();
  readonly closers = new Set<() => void>();
  private closed = false;

  constructor(dataDir: string) {
    if (dataDir !== ':memory:') mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'taskmanager.sqlite'));
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
    if (this.listProjects().length === 0) this.write(() => this.createProject({ name: '本地项目', prefix: 'LOCAL', workspacePath: null, labels: [], readme: '' }));
  }

  private migrate() {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version ?? 0);
    if (version > 1) throw new Error(`Unsupported database schema version ${version}`);
    if (version === 1) return;
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, workspace_path TEXT, labels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels)), readme TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE project_counters (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, value INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, labels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels)), assignee TEXT NOT NULL DEFAULT '', creator TEXT NOT NULL DEFAULT 'local-user', sort_order REAL NOT NULL DEFAULT 0, start_date TEXT, due_date TEXT, recurrence TEXT CHECK (recurrence IS NULL OR json_valid(recurrence)), development_context TEXT CHECK (development_context IS NULL OR json_valid(development_context)), archived_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX tasks_project_status_order ON tasks(project_id, archived_at, status, sort_order, created_at);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, platform TEXT NOT NULL, session_id TEXT NOT NULL, project_id TEXT, host_id TEXT, workspace_path TEXT, project_kind TEXT, created_at TEXT NOT NULL, UNIQUE(task_id, platform, session_id));
      CREATE TABLE comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, body TEXT NOT NULL, author TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX comments_task_created ON comments(task_id, created_at, id);
      CREATE TABLE activities (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, changes TEXT NOT NULL CHECK (json_valid(changes)), created_at TEXT NOT NULL);
      CREATE INDEX activities_task_created ON activities(task_id, created_at, id);
      CREATE TABLE attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK (size >= 0), content BLOB NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE relations (id TEXT PRIMARY KEY, type TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(type, source_id, target_id), CHECK(source_id <> target_id));
      CREATE UNIQUE INDEX relations_one_parent ON relations(target_id) WHERE type = 'parent';
      CREATE INDEX relations_source ON relations(source_id);
      CREATE INDEX relations_target ON relations(target_id);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta(key, value) VALUES ('revision', 0);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  revision() { return Number((this.db.prepare("SELECT value FROM meta WHERE key = 'revision'").get() as Row).value); }
  write<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    let result: T;
    try { result = operation(); this.db.exec("UPDATE meta SET value = value + 1 WHERE key = 'revision'; COMMIT"); }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ } throw error; }
    const revision = this.revision();
    for (const subscriber of this.subscribers) { try { subscriber(revision); } catch { /* Notification cannot undo a commit. */ } }
    return result;
  }

  private project(row: Row): Project { return { id: String(row.id), name: String(row.name), prefix: String(row.prefix), workspacePath: nullable(row.workspace_path), labels: parse(row.labels, []), readme: String(row.readme ?? ''), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), taskCount: Number(row.task_count ?? 0) }; }
  private session(row: Row): Session { return { id: String(row.id), platform: row.platform as Session['platform'], sessionId: String(row.session_id), ...(row.project_id ? { projectId: String(row.project_id) } : {}), ...(row.host_id ? { hostId: String(row.host_id) } : {}), ...(row.workspace_path ? { workspacePath: String(row.workspace_path) } : {}), ...(row.project_kind ? { projectKind: row.project_kind as Session['projectKind'] } : {}) }; }
  private task(row: Row): Task {
    const sessions = this.db.prepare('SELECT * FROM sessions WHERE task_id = ? ORDER BY created_at, id').all(String(row.id)).map((value) => this.session(value as Row));
    return { id: String(row.id), identifier: String(row.identifier), projectId: String(row.project_id), title: String(row.title), description: String(row.description), status: row.status as Task['status'], priority: row.priority as Task['priority'], labels: parse(row.labels, []), assignee: String(row.assignee), creator: String(row.creator), sortOrder: Number(row.sort_order), startDate: nullable(row.start_date), dueDate: nullable(row.due_date), recurrence: parse(row.recurrence, null), developmentContext: parse(row.development_context, null), archivedAt: nullable(row.archived_at), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), sessions };
  }
  private comment(row: Row): Comment { return { id: String(row.id), taskId: String(row.task_id), body: String(row.body), author: String(row.author), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
  private activity(row: Row): Activity { return { id: String(row.id), taskId: String(row.task_id), actor: String(row.actor), action: String(row.action), changes: parse(row.changes, {}), createdAt: String(row.created_at) }; }
  private attachment(row: Row): Attachment { return { id: String(row.id), taskId: String(row.task_id), commentId: nullable(row.comment_id), filename: String(row.filename), contentType: String(row.content_type), size: Number(row.size), createdAt: String(row.created_at) }; }
  private relation(row: Row): Relation { return { id: String(row.id), sourceId: String(row.source_id), targetId: String(row.target_id), type: row.type as Relation['type'] }; }

  listProjects() { return this.db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL GROUP BY p.id ORDER BY p.created_at, p.id`).all().map((row) => this.project(row as Row)); }
  createProject(input: { name: string; prefix?: string; workspacePath?: string | null; labels?: string[]; readme?: string }): Project {
    const now = iso(); const prefix = (input.prefix ?? (input.name.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'TASK')).toUpperCase(); const project = { id: randomUUID(), name: input.name.trim(), prefix, workspacePath: input.workspacePath ?? null, labels: input.labels ?? [], readme: input.readme ?? '', version: 1, createdAt: now, updatedAt: now, taskCount: 0 } satisfies Project;
    try { this.db.prepare('INSERT INTO projects(id,name,prefix,workspace_path,labels,readme,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(project.id, project.name, project.prefix, project.workspacePath, json(project.labels), project.readme, project.version, project.createdAt, project.updatedAt); }
    catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'PROJECT_PREFIX_EXISTS', 'Project prefix already exists'); throw error; }
    return project;
  }
  getProject(id: string) { const row = this.db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL WHERE p.id = ? GROUP BY p.id`).get(id) as Row | undefined; if (!row) fail(404, 'PROJECT_NOT_FOUND', 'Project not found'); return this.project(row); }
  updateProject(id: string, input: { version: number; name?: string; workspacePath?: string | null; labels?: string[]; readme?: string }) {
    const current = this.getProject(id); if (current.version !== input.version) fail(409, 'VERSION_CONFLICT', `Project changed; current version is ${current.version}`); const next = { ...current, ...input, version: current.version + 1, updatedAt: iso() };
    this.db.prepare('UPDATE projects SET name=?,workspace_path=?,labels=?,readme=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.name, next.workspacePath, json(next.labels), next.readme, next.version, next.updatedAt, id, current.version); return this.getProject(id);
  }
  deleteProject(id: string, version: number) { const project = this.getProject(id); if (project.version !== version) fail(409, 'VERSION_CONFLICT', `Project changed; current version is ${project.version}`); const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(id) as Row).count); if (count > 0) fail(409, 'PROJECT_NOT_EMPTY', 'Project still contains tasks'); this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); }

  listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: string }) {
    const clauses = ['1 = 1']; const values: (string | number)[] = [];
    if (filters.projectId) { clauses.push('t.project_id = ?'); values.push(filters.projectId); }
    if (filters.status) { clauses.push('t.status = ?'); values.push(filters.status); }
    if (filters.archived !== 'all') clauses.push(filters.archived === 'true' ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');
    if (filters.search?.trim()) { clauses.push('(t.identifier LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR t.labels LIKE ?)'); const search = `%${filters.search.trim()}%`; values.push(search, search, search, search); }
    return this.db.prepare(`SELECT * FROM tasks t WHERE ${clauses.join(' AND ')} ORDER BY t.status, t.sort_order, t.created_at, t.id`).all(...values).map((row) => this.task(row as Row));
  }
  getTask(id: string) { const row = this.db.prepare('SELECT * FROM tasks WHERE id = ? OR identifier = ?').get(id, id) as Row | undefined; if (!row) fail(404, 'TASK_NOT_FOUND', 'Task not found'); return this.task(row); }
  private nextSort(projectId: string, status: string) { return Number((this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE project_id = ? AND status = ? AND archived_at IS NULL').get(projectId, status) as Row).next); }
  private nextIdentifier(projectId: string) { return String((this.db.prepare('INSERT INTO project_counters(project_id,value) VALUES (?,1) ON CONFLICT(project_id) DO UPDATE SET value=value+1 RETURNING value').get(projectId) as Row).value); }
  createTask(input: TaskInput, actor: Actor) {
    const project = this.getProject(input.projectId); const now = iso(); const task: Task = { id: randomUUID(), identifier: `${project.prefix}-${this.nextIdentifier(project.id)}`, projectId: project.id, title: input.title.trim(), description: input.description ?? '', status: input.status ?? 'todo', priority: input.priority ?? 'none', labels: input.labels ?? [], assignee: input.assignee ?? '', creator: actor, sortOrder: input.sortOrder ?? this.nextSort(project.id, input.status ?? 'todo'), startDate: input.startDate ?? null, dueDate: input.dueDate ?? null, recurrence: input.recurrence ?? null, developmentContext: input.developmentContext ?? null, archivedAt: input.archivedAt ?? null, version: 1, createdAt: now, updatedAt: now, sessions: [] };
    validateTask(task); this.db.prepare('INSERT INTO tasks(id,identifier,project_id,title,description,status,priority,labels,assignee,creator,sort_order,start_date,due_date,recurrence,development_context,archived_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id, task.identifier, task.projectId, task.title, task.description, task.status, task.priority, json(task.labels), task.assignee, task.creator, task.sortOrder, task.startDate, task.dueDate, task.recurrence ? json(task.recurrence) : null, task.developmentContext ? json(task.developmentContext) : null, task.archivedAt, task.version, task.createdAt, task.updatedAt); this.addActivity(task.id, actor, 'task.created', {}, { status: task.status, title: task.title }); return this.getTask(task.id);
  }
  updateTask(id: string, input: TaskPatch, actor: Actor) {
    const current = this.getTask(id); if (current.version !== input.version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${current.version}`); const next = { ...current, ...input, id: current.id, identifier: current.identifier, projectId: input.projectId ?? current.projectId, version: current.version + 1, updatedAt: iso(), sessions: current.sessions } as Task;
    if (next.projectId !== current.projectId) { this.getProject(next.projectId); if (this.db.prepare('SELECT 1 FROM relations WHERE source_id = ? OR target_id = ? LIMIT 1').get(current.id, current.id)) fail(409, 'TASK_HAS_RELATIONS', 'Move the task relations before changing project'); }
    validateTask(next); this.db.prepare('UPDATE tasks SET project_id=?,title=?,description=?,status=?,priority=?,labels=?,assignee=?,sort_order=?,start_date=?,due_date=?,recurrence=?,development_context=?,archived_at=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.projectId, next.title.trim(), next.description, next.status, next.priority, json(next.labels), next.assignee, next.sortOrder, next.startDate, next.dueDate, next.recurrence ? json(next.recurrence) : null, next.developmentContext ? json(next.developmentContext) : null, next.archivedAt, next.version, next.updatedAt, current.id, current.version); this.addActivity(current.id, actor, 'task.updated', { status: current.status, priority: current.priority, title: current.title, projectId: current.projectId, archivedAt: current.archivedAt, sortOrder: current.sortOrder }, { status: next.status, priority: next.priority, title: next.title, projectId: next.projectId, archivedAt: next.archivedAt, sortOrder: next.sortOrder }); return this.getTask(current.id);
  }
  deleteTask(id: string, version: number) { const current = this.getTask(id); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${current.version}`); if (!current.archivedAt) fail(409, 'TASK_NOT_ARCHIVED', 'Archive the task before deleting it'); this.db.prepare('DELETE FROM tasks WHERE id = ?').run(current.id); }

  listComments(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => this.comment(row as Row)); }
  createComment(taskId: string, body: string, actor: Actor) { const task = this.getTask(taskId); if (task.archivedAt) fail(409, 'TASK_ARCHIVED', 'Archived tasks cannot receive comments'); const now = iso(); const comment: Comment = { id: randomUUID(), taskId: task.id, body, author: actor, version: 1, createdAt: now, updatedAt: now }; this.db.prepare('INSERT INTO comments(id,task_id,body,author,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(comment.id, comment.taskId, comment.body, comment.author, comment.version, comment.createdAt, comment.updatedAt); this.addActivity(task.id, actor, 'comment.created', {}, { commentId: comment.id }); return comment; }
  updateComment(id: string, body: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const current = this.comment(row); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Comment changed; current version is ${current.version}`); const next = { ...current, body, version: current.version + 1, updatedAt: iso() }; this.db.prepare('UPDATE comments SET body=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.body, next.version, next.updatedAt, id, version); this.addActivity(current.taskId, actor, 'comment.updated', { body: current.body }, { body: next.body }); return next; }
  deleteComment(id: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const current = this.comment(row); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Comment changed; current version is ${current.version}`); this.db.prepare('DELETE FROM comments WHERE id = ?').run(id); this.addActivity(current.taskId, actor, 'comment.deleted', { commentId: id }, {}); }
  listActivities(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM activities WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => this.activity(row as Row)); }
  listAttachments(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT id,task_id,comment_id,filename,content_type,size,created_at FROM attachments WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => this.attachment(row as Row)); }
  getAttachment(id: string) { const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found'); return { attachment: this.attachment(row), content: row.content as Uint8Array }; }
  createAttachment(taskId: string, input: { filename: string; contentType: string; content: Uint8Array }, actor: Actor, commentId?: string) { const task = this.getTask(taskId); if (commentId && !this.db.prepare('SELECT 1 FROM comments WHERE id = ? AND task_id = ?').get(commentId, task.id)) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const id = randomUUID(); const createdAt = iso(); const attachment: Attachment = { id, taskId: task.id, commentId: commentId ?? null, filename: input.filename, contentType: input.contentType, size: input.content.byteLength, createdAt }; this.db.prepare('INSERT INTO attachments(id,task_id,comment_id,filename,content_type,size,content,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, task.id, commentId ?? null, input.filename, input.contentType, input.content.byteLength, input.content, createdAt); this.addActivity(task.id, actor, 'attachment.created', {}, { attachmentId: id }); return attachment; }
  deleteAttachment(id: string, actor: Actor) { const { attachment } = this.getAttachment(id); this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id); this.addActivity(attachment.taskId, actor, 'attachment.deleted', { attachmentId: id }, {}); }

  listRelations(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM relations WHERE source_id = ? OR target_id = ? ORDER BY created_at, id').all(taskId, taskId).map((row) => this.relation(row as Row)); }
  addRelation(taskId: string, targetId: string, type: Relation['type'], version: number, actor: Actor) { const task = this.getTask(taskId); const target = this.getTask(targetId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); if (task.projectId !== target.projectId) fail(422, 'CROSS_PROJECT_RELATION', 'Relations must stay within one project'); let sourceId = task.id; let destinationId = target.id; if (type === 'related' && sourceId > destinationId) [sourceId, destinationId] = [destinationId, sourceId]; if (type === 'parent') { if (this.db.prepare("SELECT 1 FROM relations WHERE type='parent' AND target_id=?").get(destinationId)) fail(409, 'PARENT_EXISTS', 'A task can only have one parent'); if (this.parentReachable(destinationId, sourceId)) fail(409, 'RELATION_CYCLE', 'Parent relation would create a cycle'); } const relation: Relation = { id: randomUUID(), sourceId, targetId: destinationId, type }; try { this.db.prepare('INSERT INTO relations(id,type,source_id,target_id,created_at) VALUES (?,?,?,?,?)').run(relation.id, relation.type, relation.sourceId, relation.targetId, iso()); } catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'RELATION_EXISTS', 'Relation already exists'); throw error; } this.touchTask(task.id); if (target.id !== task.id) this.touchTask(target.id); this.addActivity(task.id, actor, 'relation.created', {}, relation as unknown as Record<string, unknown>); return relation; }
  removeRelation(id: string, taskId: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'RELATION_NOT_FOUND', 'Relation not found'); const relation = this.relation(row); const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); if (relation.sourceId !== task.id && relation.targetId !== task.id) fail(403, 'RELATION_OWNER_MISMATCH', 'Relation does not belong to this task'); this.db.prepare('DELETE FROM relations WHERE id = ?').run(id); this.touchTask(relation.sourceId); if (relation.targetId !== relation.sourceId) this.touchTask(relation.targetId); this.addActivity(task.id, actor, 'relation.deleted', relation as unknown as Record<string, unknown>, {}); }
  private parentReachable(from: string, wanted: string) { const rows = this.db.prepare("WITH RECURSIVE descendants(id) AS (SELECT target_id FROM relations WHERE type='parent' AND source_id=? UNION ALL SELECT r.target_id FROM relations r JOIN descendants d ON r.source_id=d.id WHERE r.type='parent') SELECT id FROM descendants").all(from); return rows.some((row) => String((row as Row).id) === wanted); }
  addSession(taskId: string, input: Omit<Session, 'id'>, version: number, actor: Actor) { const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); try { this.db.prepare('INSERT INTO sessions(id,task_id,platform,session_id,project_id,host_id,workspace_path,project_kind,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), task.id, input.platform, input.sessionId, input.projectId ?? null, input.hostId ?? null, input.workspacePath ?? null, input.projectKind ?? null, iso()); } catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'SESSION_EXISTS', 'Session is already linked'); throw error; } this.touchTask(task.id); this.addActivity(task.id, actor, 'session.created', {}, { platform: input.platform, sessionId: input.sessionId }); return this.getTask(task.id); }
  removeSession(taskId: string, sessionId: string, version: number, actor: Actor) { const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); const result = this.db.prepare('DELETE FROM sessions WHERE task_id=? AND session_id=?').run(taskId, sessionId); if (Number(result.changes) === 0) fail(404, 'SESSION_NOT_FOUND', 'Session not found'); this.touchTask(taskId); this.addActivity(taskId, actor, 'session.deleted', { sessionId }, {}); return this.getTask(taskId); }
  detail(id: string): TaskDetail { const task = this.getTask(id); return { task, comments: this.listComments(task.id), activities: this.listActivities(task.id), attachments: this.listAttachments(task.id), relations: this.listRelations(task.id) }; }
  private touchTask(id: string) { this.db.prepare('UPDATE tasks SET version=version+1,updated_at=? WHERE id=?').run(iso(), id); }
  private addActivity(taskId: string, actor: Actor, action: string, before: Record<string, unknown>, after: Record<string, unknown>) { const changes: Record<string, { before: unknown; after: unknown }> = {}; for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key] ?? null, after: after[key] ?? null }; this.db.prepare('INSERT INTO activities(id,task_id,actor,action,changes,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), taskId, actor, action, json(changes), iso()); }
  close() { if (this.closed) return; this.closed = true; for (const close of this.closers) close(); this.closers.clear(); this.subscribers.clear(); this.db.close(); }
}
