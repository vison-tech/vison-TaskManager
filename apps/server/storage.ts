import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Activity, Attachment, Automation, AutomationRun, Comment, Project, ProjectAttachment, Relation, Session, Task, TaskDetail, TaskInput, TaskPatch, RevisionEvent } from '../../packages/contracts/index.ts';
import type { AgentEvent, AgentEventType, AgentRun, AgentRuntimePersistence, AgentRuntimePersistedRun } from '../../packages/agent-runtime/index.ts';
import { fail, validateTask } from './validation.ts';
import { migrate } from './storage/schema.ts';
import { activity, attachment, comment, iso, json, project, projectAttachment, relation, Row, task } from './storage/serialization.ts';
import { nextRecurrenceConfig, recurrenceNextDates } from './recurrence.ts';

type Actor = string;
export type RevisionRecord = Pick<RevisionEvent, 'revision' | 'resource' | 'resourceId'>;

export class Storage {
  readonly db: DatabaseSync;
  readonly subscribers = new Set<(event: RevisionRecord) => void>();
  readonly closers = new Set<() => void>();
  private readonly revisionHistory: RevisionRecord[] = [];
  private readonly attachmentDir: string | null;
  private closed = false;

  constructor(dataDir: string) {
    if (dataDir !== ':memory:') mkdirSync(dataDir, { recursive: true });
    this.attachmentDir = dataDir === ':memory:' ? null : join(dataDir, 'attachments');
    if (this.attachmentDir) mkdirSync(this.attachmentDir, { recursive: true });
    this.db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'taskmanager.sqlite'));
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    migrate(this.db);
    this.revisionHistory.push(...this.readRevisionHistory());
    if (this.listProjects().length === 0) this.write(() => this.createProject({ name: '本地项目', prefix: 'LOCAL', workspacePath: null, labels: [], readme: '' }));
  }

  revision() { return Number((this.db.prepare("SELECT value FROM meta WHERE key = 'revision'").get() as Row).value); }
  private readRevisionHistory(): RevisionRecord[] { return (this.db.prepare('SELECT revision, resource, resource_id FROM revision_events ORDER BY revision DESC LIMIT 1000').all() as Row[]).reverse().map((row) => ({ revision: Number(row.revision), ...(row.resource ? { resource: String(row.resource) as RevisionRecord['resource'] } : {}), ...(row.resource_id ? { resourceId: String(row.resource_id) } : {}) })); }
  agentRuntimePersistence(): AgentRuntimePersistence {
    return {
      load: () => this.loadAgentRuns(),
      eventsSince: (runId, sequence) => this.agentEventsSince(runId, sequence),
      saveRunAndEvent: (run, event) => this.saveAgentRunAndEvent(run, event),
    };
  }

  private loadAgentRuns(): AgentRuntimePersistedRun[] {
    const runs = (this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at, run_id').all() as Row[]).map((row) => this.deserializeAgentRun(row));
    const events = (this.db.prepare('SELECT * FROM agent_events ORDER BY run_id, sequence').all() as Row[]).map((row) => this.deserializeAgentEvent(row));
    const eventsByRun = new Map<string, AgentEvent[]>();
    for (const event of events) eventsByRun.set(event.runId, [...(eventsByRun.get(event.runId) ?? []), event]);
    return runs.map((run) => ({ run, events: eventsByRun.get(run.runId) ?? [] }));
  }

  private agentEventsSince(runId: string, sequence: number): AgentEvent[] {
    if (this.closed) return [];
    return (this.db.prepare('SELECT * FROM agent_events WHERE run_id = ? AND sequence > ? ORDER BY sequence').all(runId, sequence) as Row[]).map((row) => this.deserializeAgentEvent(row));
  }

  private saveAgentRunAndEvent(run: AgentRun, event: AgentEvent): void {
    if (this.closed) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO agent_runs(run_id,session_id,status,request,started_at,finished_at,exit_code,signal,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET session_id=excluded.session_id,status=excluded.status,request=excluded.request,started_at=excluded.started_at,finished_at=excluded.finished_at,exit_code=excluded.exit_code,signal=excluded.signal,updated_at=excluded.updated_at`).run(
        run.runId, run.sessionId, run.status, JSON.stringify(run.request), run.startedAt, run.finishedAt ?? null, run.exitCode ?? null, run.signal ?? null, event.createdAt,
      );
      this.db.prepare('INSERT INTO agent_events(run_id,sequence,session_id,type,data,exit_code,signal,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
        event.runId, event.sequence, event.sessionId, event.type, event.data ?? null, event.exitCode ?? null, event.signal ?? null, event.createdAt,
      );
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original persistence error. */ }
      throw error;
    }
  }

  private deserializeAgentRun(row: Row): AgentRun {
    let request: AgentRun['request'];
    try { request = JSON.parse(String(row.request)) as AgentRun['request']; } catch { throw new Error(`Invalid persisted agent request for run ${String(row.run_id)}`); }
    const run: AgentRun = { runId: String(row.run_id), sessionId: String(row.session_id), status: String(row.status) as AgentRun['status'], request, startedAt: String(row.started_at) };
    if (row.finished_at !== null && row.finished_at !== undefined) run.finishedAt = String(row.finished_at);
    if (row.exit_code !== null && row.exit_code !== undefined) run.exitCode = Number(row.exit_code);
    if (row.signal !== null && row.signal !== undefined) run.signal = String(row.signal);
    return run;
  }

  private deserializeAgentEvent(row: Row): AgentEvent {
    const event: AgentEvent = { sequence: Number(row.sequence), runId: String(row.run_id), sessionId: String(row.session_id), type: String(row.type) as AgentEventType, createdAt: String(row.created_at) };
    if (row.data !== null && row.data !== undefined) event.data = String(row.data);
    if (row.exit_code !== null && row.exit_code !== undefined) event.exitCode = Number(row.exit_code);
    if (row.signal !== null && row.signal !== undefined) event.signal = String(row.signal);
    return event;
  }

  private automation(row: Row): Automation {
    return { id: String(row.id), projectId: String(row.project_id), name: String(row.name), enabled: Number(row.enabled) === 1, intervalSeconds: Number(row.interval_seconds), command: String(row.command), sessionId: String(row.session_id), input: String(row.input ?? ''), ...(row.model ? { model: String(row.model) } : {}), permissionMode: String(row.permission_mode) as Automation['permissionMode'], skillIds: JSON.parse(String(row.skill_ids ?? '[]')) as string[], nextRunAt: String(row.next_run_at), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  private automationRun(row: Row): AutomationRun {
    return { id: String(row.id), automationId: String(row.automation_id), triggerKey: String(row.trigger_key), runId: row.run_id ? String(row.run_id) : null, status: String(row.status) as AutomationRun['status'], ...(row.reason ? { reason: String(row.reason) } : {}), createdAt: String(row.created_at), finishedAt: row.finished_at ? String(row.finished_at) : null };
  }

  listAutomations(projectId?: string) { const rows = (projectId ? this.db.prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at, id').all(projectId) : this.db.prepare('SELECT * FROM automations ORDER BY created_at, id').all()) as Row[]; return rows.map((row) => this.automation(row)); }
  getAutomation(id: string) { const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'AUTOMATION_NOT_FOUND', 'Automation not found'); return this.automation(row); }
  createAutomation(input: { projectId: string; name: string; enabled: boolean; intervalSeconds: number; command: string; sessionId: string; input: string; model?: string; permissionMode: Automation['permissionMode']; skillIds: string[]; nextRunAt?: string }) {
    this.getProject(input.projectId); const now = iso(); const automation: Automation = { id: randomUUID(), projectId: input.projectId, name: input.name.trim(), enabled: input.enabled, intervalSeconds: input.intervalSeconds, command: input.command, sessionId: input.sessionId, input: input.input, ...(input.model ? { model: input.model } : {}), permissionMode: input.permissionMode, skillIds: [...input.skillIds], nextRunAt: input.nextRunAt ?? now, version: 1, createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO automations(id,project_id,name,enabled,interval_seconds,command,session_id,input,model,permission_mode,skill_ids,next_run_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(automation.id, automation.projectId, automation.name, automation.enabled ? 1 : 0, automation.intervalSeconds, automation.command, automation.sessionId, automation.input, automation.model ?? null, automation.permissionMode, json(automation.skillIds), automation.nextRunAt, automation.version, automation.createdAt, automation.updatedAt);
    return automation;
  }
  updateAutomation(id: string, input: { version: number; name?: string; enabled?: boolean; intervalSeconds?: number; command?: string; sessionId?: string; input?: string; model?: string | null; permissionMode?: Automation['permissionMode']; skillIds?: string[]; nextRunAt?: string }) {
    const current = this.getAutomation(id); if (current.version !== input.version) fail(409, 'VERSION_CONFLICT', `Automation changed; current version is ${current.version}`); const next: Automation = { ...current, ...input, model: input.model === null ? undefined : input.model ?? current.model, version: current.version + 1, updatedAt: iso() }; this.db.prepare('UPDATE automations SET name=?,enabled=?,interval_seconds=?,command=?,session_id=?,input=?,model=?,permission_mode=?,skill_ids=?,next_run_at=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.name, next.enabled ? 1 : 0, next.intervalSeconds, next.command, next.sessionId, next.input, next.model ?? null, next.permissionMode, json(next.skillIds), next.nextRunAt, next.version, next.updatedAt, id, current.version); return this.getAutomation(id);
  }
  deleteAutomation(id: string, version: number) { const current = this.getAutomation(id); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Automation changed; current version is ${current.version}`); this.db.prepare('DELETE FROM automations WHERE id = ?').run(id); }
  claimAutomationTrigger(id: string, now = new Date()): AutomationRun | null {
    const current = this.getAutomation(id); if (!current.enabled || Date.parse(current.nextRunAt) > now.valueOf()) return null; const triggerKey = current.nextRunAt; const run: AutomationRun = { id: randomUUID(), automationId: id, triggerKey, runId: null, status: 'started', createdAt: now.toISOString(), finishedAt: null }; const nextRunAt = new Date(Math.max(now.valueOf(), Date.parse(triggerKey)) + current.intervalSeconds * 1000).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('INSERT INTO automation_runs(id,automation_id,trigger_key,run_id,status,reason,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?)').run(run.id, run.automationId, run.triggerKey, null, run.status, null, run.createdAt, null); this.db.prepare('UPDATE automations SET next_run_at=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(nextRunAt, run.createdAt, id, current.version); this.db.exec('COMMIT'); return run; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original claim error. */ } if (String(error).includes('UNIQUE')) return null; throw error; }
  }
  updateAutomationRun(id: string, input: { runId?: string | null; status: AutomationRun['status']; reason?: string }) { const current = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as Row | undefined; if (!current) fail(404, 'AUTOMATION_RUN_NOT_FOUND', 'Automation run not found'); const finishedAt = input.status === 'started' ? null : iso(); this.db.prepare('UPDATE automation_runs SET run_id=COALESCE(?,run_id),status=?,reason=?,finished_at=? WHERE id=?').run(input.runId ?? null, input.status, input.reason ?? null, finishedAt, id); return this.automationRun(this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as Row); }
  listAutomationRuns(automationId: string) { this.getAutomation(automationId); return (this.db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC, id DESC').all(automationId) as Row[]).map((row) => this.automationRun(row)); }

  write<T>(operation: () => T, resource: Omit<RevisionRecord, 'revision'> = {}): T {
    this.db.exec('BEGIN IMMEDIATE');
    let result: T;
    try {
      result = operation();
      this.db.exec("UPDATE meta SET value = value + 1 WHERE key = 'revision'");
      const revision = this.revision();
      this.db.prepare('INSERT INTO revision_events(revision, resource, resource_id) VALUES (?,?,?)').run(revision, resource.resource ?? null, resource.resourceId ?? null);
      this.db.prepare('DELETE FROM revision_events WHERE revision <= ?').run(Math.max(0, revision - 1000));
      this.db.exec('COMMIT');
    }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original error. */ } throw error; }
    const revision = this.revision();
    const event: RevisionRecord = { revision, ...resource };
    this.revisionHistory.push(event);
    if (this.revisionHistory.length > 1000) this.revisionHistory.splice(0, this.revisionHistory.length - 1000);
    for (const subscriber of this.subscribers) { try { subscriber(event); } catch { /* Notification cannot undo a commit. */ } }
    return result;
  }

  revisionsSince(lastRevision: number): RevisionRecord[] { return this.readRevisionHistory().filter((event) => event.revision > lastRevision).map((event) => ({ ...event })); }

  listProjects() { return this.db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL GROUP BY p.id ORDER BY p.created_at, p.id`).all().map((row) => project(row as Row)); }
  createProject(input: { name: string; prefix?: string; workspacePath?: string | null; labels?: string[]; readme?: string }): Project {
    const now = iso(); const prefix = (input.prefix ?? (input.name.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'TASK')).toUpperCase(); const project = { id: randomUUID(), name: input.name.trim(), prefix, workspacePath: input.workspacePath ?? null, labels: input.labels ?? [], readme: input.readme ?? '', version: 1, createdAt: now, updatedAt: now, taskCount: 0 } satisfies Project;
    try { this.db.prepare('INSERT INTO projects(id,name,prefix,workspace_path,labels,readme,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(project.id, project.name, project.prefix, project.workspacePath, json(project.labels), project.readme, project.version, project.createdAt, project.updatedAt); }
    catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'PROJECT_PREFIX_EXISTS', 'Project prefix already exists'); throw error; }
    return project;
  }
  getProject(id: string) { const row = this.db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL WHERE p.id = ? GROUP BY p.id`).get(id) as Row | undefined; if (!row) fail(404, 'PROJECT_NOT_FOUND', 'Project not found'); return project(row); }
  updateProject(id: string, input: { version: number; name?: string; workspacePath?: string | null; labels?: string[]; readme?: string }) {
    const current = this.getProject(id); if (current.version !== input.version) fail(409, 'VERSION_CONFLICT', `Project changed; current version is ${current.version}`); const next = { ...current, ...input, version: current.version + 1, updatedAt: iso() };
    this.db.prepare('UPDATE projects SET name=?,workspace_path=?,labels=?,readme=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.name, next.workspacePath, json(next.labels), next.readme, next.version, next.updatedAt, id, current.version); return this.getProject(id);
  }
  deleteProject(id: string, version: number) { const project = this.getProject(id); if (project.version !== version) fail(409, 'VERSION_CONFLICT', `Project changed; current version is ${project.version}`); const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?').get(id) as Row).count); if (count > 0) fail(409, 'PROJECT_NOT_EMPTY', 'Project still contains tasks'); const keys = this.db.prepare('SELECT storage_key FROM project_attachments WHERE project_id = ? AND storage_key IS NOT NULL').all(id) as Row[]; this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); for (const row of keys) this.removeContent(String(row.storage_key)); }

  listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: string }) {
    const clauses = ['1 = 1']; const values: (string | number)[] = [];
    if (filters.projectId) { clauses.push('t.project_id = ?'); values.push(filters.projectId); }
    if (filters.status) { clauses.push('t.status = ?'); values.push(filters.status); }
    if (filters.archived !== 'all') clauses.push(filters.archived === 'true' ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');
    if (filters.search?.trim()) { clauses.push('(t.identifier LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR t.labels LIKE ?)'); const search = `%${filters.search.trim()}%`; values.push(search, search, search, search); }
    return this.db.prepare(`SELECT * FROM tasks t WHERE ${clauses.join(' AND ')} ORDER BY t.status, t.sort_order, t.created_at, t.id`).all(...values).map((row) => task(this.db, row as Row));
  }
  listTasksPage(filters: { projectId?: string; status?: string; search?: string; archived?: string; cursor?: string; limit?: number }) {
    const clauses = ['1 = 1']; const values: (string | number)[] = [];
    if (filters.projectId) { clauses.push('t.project_id = ?'); values.push(filters.projectId); }
    if (filters.status) { clauses.push('t.status = ?'); values.push(filters.status); }
    if (filters.archived !== 'all') clauses.push(filters.archived === 'true' ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');
    if (filters.search?.trim()) { clauses.push('(t.identifier LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR t.labels LIKE ?)'); const search = `%${filters.search.trim()}%`; values.push(search, search, search, search); }
    if (filters.cursor) {
      let cursor: { status: string; sortOrder: number; createdAt: string; id: string };
      try { cursor = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8')) as typeof cursor; } catch { fail(422, 'INVALID_CURSOR', 'cursor is invalid'); }
      clauses.push('(t.status > ? OR (t.status = ? AND (t.sort_order > ? OR (t.sort_order = ? AND (t.created_at > ? OR (t.created_at = ? AND t.id > ?))))))');
      values.push(cursor.status, cursor.status, cursor.sortOrder, cursor.sortOrder, cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 100);
    const rows = this.db.prepare(`SELECT * FROM tasks t WHERE ${clauses.join(' AND ')} ORDER BY t.status, t.sort_order, t.created_at, t.id LIMIT ?`).all(...values, limit + 1) as Row[];
    const pageRows = rows.slice(0, limit); const last = pageRows.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ status: String(last.status), sortOrder: Number(last.sort_order), createdAt: String(last.created_at), id: String(last.id) })).toString('base64url') : null;
    return { items: pageRows.map((row) => task(this.db, row)), nextCursor };
  }
  getTask(id: string) { const row = this.db.prepare('SELECT * FROM tasks WHERE id = ? OR identifier = ?').get(id, id) as Row | undefined; if (!row) fail(404, 'TASK_NOT_FOUND', 'Task not found'); return task(this.db, row); }
  private nextSort(projectId: string, status: string) { return Number((this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE project_id = ? AND status = ? AND archived_at IS NULL').get(projectId, status) as Row).next); }
  private nextIdentifier(projectId: string) { return String((this.db.prepare('INSERT INTO project_counters(project_id,value) VALUES (?,1) ON CONFLICT(project_id) DO UPDATE SET value=value+1 RETURNING value').get(projectId) as Row).value); }
  createTask(input: TaskInput, actor: Actor) {
    const project = this.getProject(input.projectId); const now = iso(); const task: Task = { id: randomUUID(), identifier: `${project.prefix}-${this.nextIdentifier(project.id)}`, projectId: project.id, title: input.title.trim(), description: input.description ?? '', status: input.status ?? 'todo', priority: input.priority ?? 'none', labels: input.labels ?? [], assignee: input.assignee ?? '', creator: actor, sortOrder: input.sortOrder ?? this.nextSort(project.id, input.status ?? 'todo'), startDate: input.startDate ?? null, dueDate: input.dueDate ?? null, recurrence: input.recurrence ?? null, developmentContext: input.developmentContext ?? null, archivedAt: input.archivedAt ?? null, version: 1, createdAt: now, updatedAt: now, sessions: [] };
    validateTask(task); this.db.prepare('INSERT INTO tasks(id,identifier,project_id,title,description,status,priority,labels,assignee,creator,sort_order,start_date,due_date,recurrence,development_context,archived_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id, task.identifier, task.projectId, task.title, task.description, task.status, task.priority, json(task.labels), task.assignee, task.creator, task.sortOrder, task.startDate, task.dueDate, task.recurrence ? json(task.recurrence) : null, task.developmentContext ? json(task.developmentContext) : null, task.archivedAt, task.version, task.createdAt, task.updatedAt); this.addActivity(task.id, actor, 'task.created', {}, { status: task.status, title: task.title }); return this.getTask(task.id);
  }
  copyTask(id: string, input: { version: number; projectId?: string; title?: string }, actor: Actor) {
    const source = this.getTask(id); if (source.version !== input.version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${source.version}`);
    const copied = this.createTask({ projectId: input.projectId ?? source.projectId, title: input.title?.trim() || `${source.title}（副本）`, description: source.description, status: source.status, priority: source.priority, labels: source.labels, assignee: source.assignee, startDate: source.startDate, dueDate: source.dueDate, recurrence: source.recurrence, developmentContext: source.developmentContext }, actor);
    this.addActivity(copied.id, actor, 'task.copied', { sourceTaskId: source.id }, { sourceTaskId: source.id });
    return this.getTask(copied.id);
  }
  completeTask(id: string, version: number, actor: Actor) {
    const current = this.getTask(id);
    if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${current.version}`);
    if (current.archivedAt) fail(409, 'TASK_ARCHIVED', 'Archived tasks cannot be completed');
    if (current.status === 'done') return { task: current, nextTask: null };
    const completed = { ...current, status: 'done' as const, version: current.version + 1, updatedAt: iso() };
    validateTask(completed);
    this.db.prepare('UPDATE tasks SET status=?,version=?,updated_at=? WHERE id=? AND version=?').run(completed.status, completed.version, completed.updatedAt, current.id, current.version);
    this.addActivity(current.id, actor, 'task.completed', { status: current.status }, { status: completed.status });
    let nextTask: Task | null = null;
    const dates = recurrenceNextDates(current);
    if (dates && current.recurrence && current.dueDate) {
      const occurrence = (current.recurrence.occurrence ?? 0) + 1;
      nextTask = this.createTask({ projectId: current.projectId, title: current.title, description: current.description, status: 'todo', priority: current.priority, labels: current.labels, assignee: current.assignee, startDate: dates.startDate, dueDate: dates.dueDate, recurrence: nextRecurrenceConfig(current.recurrence, current.recurrence.anchorDate ?? current.dueDate, occurrence), developmentContext: current.developmentContext }, actor);
      this.addActivity(current.id, actor, 'task.recurring.created', {}, { nextTaskId: nextTask.id });
    }
    return { task: this.getTask(current.id), nextTask };
  }
  updateTask(id: string, input: TaskPatch, actor: Actor) {
    const current = this.getTask(id); if (current.version !== input.version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${current.version}`); const next = { ...current, ...input, id: current.id, identifier: current.identifier, projectId: input.projectId ?? current.projectId, version: current.version + 1, updatedAt: iso(), sessions: current.sessions } as Task;
    if (next.projectId !== current.projectId) { this.getProject(next.projectId); if (this.db.prepare('SELECT 1 FROM relations WHERE source_id = ? OR target_id = ? LIMIT 1').get(current.id, current.id)) fail(409, 'TASK_HAS_RELATIONS', 'Move the task relations before changing project'); }
    validateTask(next); this.db.prepare('UPDATE tasks SET project_id=?,title=?,description=?,status=?,priority=?,labels=?,assignee=?,sort_order=?,start_date=?,due_date=?,recurrence=?,development_context=?,archived_at=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.projectId, next.title.trim(), next.description, next.status, next.priority, json(next.labels), next.assignee, next.sortOrder, next.startDate, next.dueDate, next.recurrence ? json(next.recurrence) : null, next.developmentContext ? json(next.developmentContext) : null, next.archivedAt, next.version, next.updatedAt, current.id, current.version); this.addActivity(current.id, actor, 'task.updated', { status: current.status, priority: current.priority, title: current.title, projectId: current.projectId, archivedAt: current.archivedAt, sortOrder: current.sortOrder }, { status: next.status, priority: next.priority, title: next.title, projectId: next.projectId, archivedAt: next.archivedAt, sortOrder: next.sortOrder }); return this.getTask(current.id);
  }
  deleteTask(id: string, version: number) { const current = this.getTask(id); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${current.version}`); if (!current.archivedAt) fail(409, 'TASK_NOT_ARCHIVED', 'Archive the task before deleting it'); const keys = this.db.prepare('SELECT storage_key FROM attachments WHERE task_id = ? AND storage_key IS NOT NULL').all(current.id) as Row[]; this.db.prepare('DELETE FROM tasks WHERE id = ?').run(current.id); for (const row of keys) this.removeContent(String(row.storage_key)); }

  listComments(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => comment(row as Row)); }
  listCommentsPage(taskId: string, cursor?: string, limit = 100): { items: Comment[]; nextCursor: string | null } {
    this.getTask(taskId); const values: (string | number)[] = [taskId]; let clause = 'task_id = ?';
    if (cursor) { let parsed: { createdAt: string; rowId: number }; try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof parsed; } catch { fail(422, 'INVALID_CURSOR', 'cursor is invalid'); } clause += ' AND (created_at > ? OR (created_at = ? AND rowid > ?))'; values.push(parsed.createdAt, parsed.createdAt, parsed.rowId); }
    const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 100); const rows = this.db.prepare(`SELECT rowid, * FROM comments WHERE ${clause} ORDER BY created_at, rowid LIMIT ?`).all(...values, pageSize + 1) as Row[]; const pageRows = rows.slice(0, pageSize); const last = pageRows.at(-1);
    return { items: pageRows.map((row) => comment(row)), nextCursor: rows.length > pageSize && last ? Buffer.from(JSON.stringify({ createdAt: String(last.created_at), rowId: Number(last.rowid) })).toString('base64url') : null };
  }
  createComment(taskId: string, body: string, actor: Actor) { const task = this.getTask(taskId); if (task.archivedAt) fail(409, 'TASK_ARCHIVED', 'Archived tasks cannot receive comments'); const now = iso(); const comment: Comment = { id: randomUUID(), taskId: task.id, body, author: actor, version: 1, createdAt: now, updatedAt: now }; this.db.prepare('INSERT INTO comments(id,task_id,body,author,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(comment.id, comment.taskId, comment.body, comment.author, comment.version, comment.createdAt, comment.updatedAt); this.addActivity(task.id, actor, 'comment.created', {}, { commentId: comment.id }); return comment; }
  updateComment(id: string, body: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const current = comment(row); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Comment changed; current version is ${current.version}`); const next = { ...current, body, version: current.version + 1, updatedAt: iso() }; this.db.prepare('UPDATE comments SET body=?,version=?,updated_at=? WHERE id=? AND version=?').run(next.body, next.version, next.updatedAt, id, version); this.addActivity(current.taskId, actor, 'comment.updated', { body: current.body }, { body: next.body }); return next; }
  deleteComment(id: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const current = comment(row); if (current.version !== version) fail(409, 'VERSION_CONFLICT', `Comment changed; current version is ${current.version}`); const keys = this.db.prepare('SELECT storage_key FROM attachments WHERE comment_id = ? AND storage_key IS NOT NULL').all(id) as Row[]; this.db.prepare('DELETE FROM comments WHERE id = ?').run(id); for (const key of keys) this.removeContent(String(key.storage_key)); this.addActivity(current.taskId, actor, 'comment.deleted', { commentId: id }, {}); }
  listActivities(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM activities WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => activity(row as Row)); }
  listActivitiesPage(taskId: string, cursor?: string, limit = 100): { items: Activity[]; nextCursor: string | null } {
    this.getTask(taskId); const values: (string | number)[] = [taskId]; let clause = 'task_id = ?';
    if (cursor) { let parsed: { createdAt: string; rowId: number }; try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof parsed; } catch { fail(422, 'INVALID_CURSOR', 'cursor is invalid'); } clause += ' AND (created_at > ? OR (created_at = ? AND rowid > ?))'; values.push(parsed.createdAt, parsed.createdAt, parsed.rowId); }
    const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 100); const rows = this.db.prepare(`SELECT rowid, * FROM activities WHERE ${clause} ORDER BY created_at, rowid LIMIT ?`).all(...values, pageSize + 1) as Row[]; const pageRows = rows.slice(0, pageSize); const last = pageRows.at(-1);
    return { items: pageRows.map((row) => activity(row)), nextCursor: rows.length > pageSize && last ? Buffer.from(JSON.stringify({ createdAt: String(last.created_at), rowId: Number(last.rowid) })).toString('base64url') : null };
  }
  listAttachments(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT id,task_id,comment_id,filename,content_type,size,created_at FROM attachments WHERE task_id = ? ORDER BY created_at, id').all(taskId).map((row) => attachment(row as Row)); }
  getAttachment(id: string) { const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found'); return { attachment: attachment(row), content: this.readContent(row) }; }
  createAttachment(taskId: string, input: { filename: string; contentType: string; content: Uint8Array }, actor: Actor, commentId?: string) { const task = this.getTask(taskId); if (commentId && !this.db.prepare('SELECT 1 FROM comments WHERE id = ? AND task_id = ?').get(commentId, task.id)) fail(404, 'COMMENT_NOT_FOUND', 'Comment not found'); const id = randomUUID(); const createdAt = iso(); const storageKey = this.attachmentDir ? `attachments/${id}` : null; try { if (storageKey) this.writeContent(storageKey, input.content); this.db.prepare('INSERT INTO attachments(id,task_id,comment_id,filename,content_type,size,content,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, task.id, commentId ?? null, input.filename, input.contentType, input.content.byteLength, storageKey ? Buffer.alloc(0) : input.content, storageKey, createdAt); this.addActivity(task.id, actor, 'attachment.created', {}, { attachmentId: id }); } catch (error) { if (storageKey) this.removeContent(storageKey); throw error; } const attachment: Attachment = { id, taskId: task.id, commentId: commentId ?? null, filename: input.filename, contentType: input.contentType, size: input.content.byteLength, createdAt }; return attachment; }
  deleteAttachment(id: string, actor: Actor) { const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found'); const current = attachment(row); const storageKey = typeof row.storage_key === 'string' ? row.storage_key : null; this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id); if (storageKey) this.removeContent(storageKey); this.addActivity(current.taskId, actor, 'attachment.deleted', { attachmentId: id }, {}); }
  listProjectAttachments(projectId: string) { this.getProject(projectId); return this.db.prepare('SELECT id,project_id,filename,content_type,size,created_at FROM project_attachments WHERE project_id = ? ORDER BY created_at, id').all(projectId).map((row) => projectAttachment(row as Row)); }
  getProjectAttachment(id: string) { const row = this.db.prepare('SELECT * FROM project_attachments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'ATTACHMENT_NOT_FOUND', 'Project attachment not found'); return { attachment: projectAttachment(row), content: this.readContent(row) }; }
  createProjectAttachment(projectId: string, input: { filename: string; contentType: string; content: Uint8Array }) { this.getProject(projectId); const id = randomUUID(); const createdAt = iso(); const storageKey = this.attachmentDir ? `attachments/${id}` : null; try { if (storageKey) this.writeContent(storageKey, input.content); this.db.prepare('INSERT INTO project_attachments(id,project_id,filename,content_type,size,content,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, projectId, input.filename, input.contentType, input.content.byteLength, storageKey ? Buffer.alloc(0) : input.content, storageKey, createdAt); } catch (error) { if (storageKey) this.removeContent(storageKey); throw error; } return { id, projectId, filename: input.filename, contentType: input.contentType, size: input.content.byteLength, createdAt } satisfies ProjectAttachment; }
  deleteProjectAttachment(id: string) { const row = this.db.prepare('SELECT * FROM project_attachments WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'ATTACHMENT_NOT_FOUND', 'Project attachment not found'); const storageKey = typeof row.storage_key === 'string' ? row.storage_key : null; this.db.prepare('DELETE FROM project_attachments WHERE id = ?').run(id); if (storageKey) this.removeContent(storageKey); }

  listRelations(taskId: string) { this.getTask(taskId); return this.db.prepare('SELECT * FROM relations WHERE source_id = ? OR target_id = ? ORDER BY created_at, id').all(taskId, taskId).map((row) => relation(row as Row)); }
  listProjectRelations(projectId: string) { this.getProject(projectId); return this.db.prepare('SELECT r.* FROM relations r JOIN tasks source_task ON source_task.id = r.source_id WHERE source_task.project_id = ? ORDER BY r.created_at, r.id').all(projectId).map((row) => relation(row as Row)); }
  addRelation(taskId: string, targetId: string, type: Relation['type'], version: number, actor: Actor) { const task = this.getTask(taskId); const target = this.getTask(targetId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); if (task.projectId !== target.projectId) fail(422, 'CROSS_PROJECT_RELATION', 'Relations must stay within one project'); let sourceId = task.id; let destinationId = target.id; if (type === 'related' && sourceId > destinationId) [sourceId, destinationId] = [destinationId, sourceId]; if (type === 'parent') { if (this.db.prepare("SELECT 1 FROM relations WHERE type='parent' AND target_id=?").get(destinationId)) fail(409, 'PARENT_EXISTS', 'A task can only have one parent'); if (this.parentReachable(destinationId, sourceId)) fail(409, 'RELATION_CYCLE', 'Parent relation would create a cycle'); } const relation: Relation = { id: randomUUID(), sourceId, targetId: destinationId, type }; try { this.db.prepare('INSERT INTO relations(id,type,source_id,target_id,created_at) VALUES (?,?,?,?,?)').run(relation.id, relation.type, relation.sourceId, relation.targetId, iso()); } catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'RELATION_EXISTS', 'Relation already exists'); throw error; } this.touchTask(task.id); if (target.id !== task.id) this.touchTask(target.id); this.addActivity(task.id, actor, 'relation.created', {}, relation as unknown as Record<string, unknown>); return relation; }
  removeRelation(id: string, taskId: string, version: number, actor: Actor) { const row = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as Row | undefined; if (!row) fail(404, 'RELATION_NOT_FOUND', 'Relation not found'); const currentRelation = relation(row); const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); if (currentRelation.sourceId !== task.id && currentRelation.targetId !== task.id) fail(403, 'RELATION_OWNER_MISMATCH', 'Relation does not belong to this task'); this.db.prepare('DELETE FROM relations WHERE id = ?').run(id); this.touchTask(currentRelation.sourceId); if (currentRelation.targetId !== currentRelation.sourceId) this.touchTask(currentRelation.targetId); this.addActivity(task.id, actor, 'relation.deleted', currentRelation as unknown as Record<string, unknown>, {}); }
  private parentReachable(from: string, wanted: string) { const rows = this.db.prepare("WITH RECURSIVE descendants(id) AS (SELECT target_id FROM relations WHERE type='parent' AND source_id=? UNION ALL SELECT r.target_id FROM relations r JOIN descendants d ON r.source_id=d.id WHERE r.type='parent') SELECT id FROM descendants").all(from); return rows.some((row) => String((row as Row).id) === wanted); }
  addSession(taskId: string, input: Omit<Session, 'id'>, version: number, actor: Actor) { const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); try { this.db.prepare('INSERT INTO sessions(id,task_id,platform,session_id,project_id,host_id,workspace_path,project_kind,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), task.id, input.platform, input.sessionId, input.projectId ?? null, input.hostId ?? null, input.workspacePath ?? null, input.projectKind ?? null, iso()); } catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'SESSION_EXISTS', 'Session is already linked'); throw error; } this.touchTask(task.id); this.addActivity(task.id, actor, 'session.created', {}, { platform: input.platform, sessionId: input.sessionId }); return this.getTask(task.id); }
  removeSession(taskId: string, sessionId: string, version: number, actor: Actor) { const task = this.getTask(taskId); if (task.version !== version) fail(409, 'VERSION_CONFLICT', `Task changed; current version is ${task.version}`); const result = this.db.prepare('DELETE FROM sessions WHERE task_id=? AND session_id=?').run(taskId, sessionId); if (Number(result.changes) === 0) fail(404, 'SESSION_NOT_FOUND', 'Session not found'); this.touchTask(taskId); this.addActivity(taskId, actor, 'session.deleted', { sessionId }, {}); return this.getTask(taskId); }
  detail(id: string): TaskDetail { const task = this.getTask(id); return { task, comments: this.listComments(task.id), activities: this.listActivities(task.id), attachments: this.listAttachments(task.id), relations: this.listRelations(task.id) }; }
  tree(id: string, direction: 'ancestors' | 'descendants', depth: number) {
    const root = this.getTask(id); const nodes = [root]; const nodeIds = new Set([root.id]); const relations: Relation[] = []; let frontier = [root.id];
    for (let level = 0; level < depth && frontier.length; level += 1) {
      const next: string[] = [];
      for (const current of frontier) for (const candidate of this.listRelations(current)) {
        if (candidate.type !== 'parent') continue;
        const nextId = direction === 'descendants' ? (candidate.sourceId === current ? candidate.targetId : null) : (candidate.targetId === current ? candidate.sourceId : null);
        if (!nextId) continue;
        if (!relations.some((item) => item.id === candidate.id)) relations.push(candidate);
        if (!nodeIds.has(nextId)) { nodeIds.add(nextId); if (nodeIds.size > 500) fail(422, 'TREE_TOO_LARGE', 'Tree exceeds 500 nodes; reduce depth'); nodes.push(this.getTask(nextId)); next.push(nextId); }
      }
      frontier = next;
    }
    return { nodes, relations };
  }
  private touchTask(id: string) { this.db.prepare('UPDATE tasks SET version=version+1,updated_at=? WHERE id=?').run(iso(), id); }
  private readContent(row: Row): Uint8Array {
    if (typeof row.storage_key === 'string' && this.attachmentDir) {
      try { return readFileSync(join(this.attachmentDir, String(row.storage_key).replace(/^attachments\//, ''))); } catch { fail(500, 'ATTACHMENT_CONTENT_MISSING', 'Attachment content is missing from the file store'); }
    }
    return row.content as Uint8Array;
  }
  private writeContent(storageKey: string, content: Uint8Array) {
    if (!this.attachmentDir) return;
    const target = join(this.attachmentDir, storageKey.replace(/^attachments\//, ''));
    const temp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temp, content);
    renameSync(temp, target);
  }
  private removeContent(storageKey: string) {
    if (!this.attachmentDir) return;
    try { unlinkSync(join(this.attachmentDir, storageKey.replace(/^attachments\//, ''))); } catch { /* The database row is authoritative after a delete. */ }
  }
  private addActivity(taskId: string, actor: Actor, action: string, before: Record<string, unknown>, after: Record<string, unknown>) { const changes: Record<string, { before: unknown; after: unknown }> = {}; for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key] ?? null, after: after[key] ?? null }; this.db.prepare('INSERT INTO activities(id,task_id,actor,action,changes,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), taskId, actor, action, json(changes), iso()); }
  close() { if (this.closed) return; this.closed = true; for (const close of this.closers) close(); this.closers.clear(); this.subscribers.clear(); this.db.close(); }
}
