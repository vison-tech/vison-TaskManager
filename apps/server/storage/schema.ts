import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

export function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version ?? 0);
  if (version > 6) throw new Error(`Unsupported database schema version ${version}`);
  if (version === 1) {
    db.exec(`BEGIN IMMEDIATE; CREATE TABLE project_attachments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK (size >= 0), content BLOB NOT NULL, created_at TEXT NOT NULL); CREATE INDEX project_attachments_project_created ON project_attachments(project_id, created_at, id); PRAGMA user_version = 2; COMMIT;`);
    db.exec(`BEGIN IMMEDIATE; ALTER TABLE attachments ADD COLUMN storage_key TEXT; ALTER TABLE project_attachments ADD COLUMN storage_key TEXT; CREATE UNIQUE INDEX attachments_storage_key ON attachments(storage_key) WHERE storage_key IS NOT NULL; CREATE UNIQUE INDEX project_attachments_storage_key ON project_attachments(storage_key) WHERE storage_key IS NOT NULL; PRAGMA user_version = 3; COMMIT;`);
    createAgentTables(db); createAutomationTables(db); createRevisionEvents(db);
    return;
  }
  if (version === 2) {
    db.exec(`BEGIN IMMEDIATE; ALTER TABLE attachments ADD COLUMN storage_key TEXT; ALTER TABLE project_attachments ADD COLUMN storage_key TEXT; CREATE UNIQUE INDEX attachments_storage_key ON attachments(storage_key) WHERE storage_key IS NOT NULL; CREATE UNIQUE INDEX project_attachments_storage_key ON project_attachments(storage_key) WHERE storage_key IS NOT NULL; PRAGMA user_version = 3; COMMIT;`);
    createAgentTables(db); createAutomationTables(db); createRevisionEvents(db);
    return;
  }
  if (version === 3) { createAgentTables(db); createAutomationTables(db); createRevisionEvents(db); return; }
  if (version === 4) { createAutomationTables(db); createRevisionEvents(db); return; }
  if (version === 5) { createRevisionEvents(db); return; }
  if (version === 6) return;
  db.exec(`
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
    CREATE TABLE attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK (size >= 0), content BLOB NOT NULL, storage_key TEXT, created_at TEXT NOT NULL);
    CREATE TABLE relations (id TEXT PRIMARY KEY, type TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(type, source_id, target_id), CHECK(source_id <> target_id));
    CREATE UNIQUE INDEX relations_one_parent ON relations(target_id) WHERE type = 'parent';
    CREATE INDEX relations_source ON relations(source_id);
    CREATE INDEX relations_target ON relations(target_id);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO meta(key, value) VALUES ('revision', 0);
    CREATE TABLE project_attachments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK (size >= 0), content BLOB NOT NULL, storage_key TEXT, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX attachments_storage_key ON attachments(storage_key) WHERE storage_key IS NOT NULL;
    CREATE UNIQUE INDEX project_attachments_storage_key ON project_attachments(storage_key) WHERE storage_key IS NOT NULL;
    CREATE INDEX project_attachments_project_created ON project_attachments(project_id, created_at, id);
    CREATE TABLE agent_runs (run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')), request TEXT NOT NULL CHECK (json_valid(request)), started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER, signal TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX agent_runs_session_status ON agent_runs(session_id, status);
    CREATE TABLE agent_events (run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE, sequence INTEGER NOT NULL CHECK (sequence > 0), session_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('started', 'stdout', 'stderr', 'completed', 'failed', 'cancelled', 'interrupted')), data TEXT, exit_code INTEGER, signal TEXT, created_at TEXT NOT NULL, PRIMARY KEY (run_id, sequence));
    CREATE INDEX agent_events_run_sequence ON agent_events(run_id, sequence);
    CREATE TABLE automations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 1 AND 604800), command TEXT NOT NULL, session_id TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', model TEXT, permission_mode TEXT NOT NULL CHECK (permission_mode IN ('read','write','full')), skill_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skill_ids)), next_run_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX automations_project_enabled ON automations(project_id, enabled, next_run_at);
    CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, trigger_key TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK (status IN ('started','completed','failed','skipped')), reason TEXT, created_at TEXT NOT NULL, finished_at TEXT, UNIQUE(automation_id, trigger_key));
    CREATE INDEX automation_runs_automation_created ON automation_runs(automation_id, created_at);
    CREATE TABLE revision_events (revision INTEGER PRIMARY KEY CHECK (revision >= 0), resource TEXT, resource_id TEXT);
    CREATE INDEX revision_events_revision ON revision_events(revision);
    PRAGMA user_version = 6;
    COMMIT;
  `);
}

function createAutomationTables(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE automations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 1 AND 604800), command TEXT NOT NULL, session_id TEXT NOT NULL, input TEXT NOT NULL DEFAULT '', model TEXT, permission_mode TEXT NOT NULL CHECK (permission_mode IN ('read','write','full')), skill_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skill_ids)), next_run_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX automations_project_enabled ON automations(project_id, enabled, next_run_at);
    CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, trigger_key TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK (status IN ('started','completed','failed','skipped')), reason TEXT, created_at TEXT NOT NULL, finished_at TEXT, UNIQUE(automation_id, trigger_key));
    CREATE INDEX automation_runs_automation_created ON automation_runs(automation_id, created_at);
    PRAGMA user_version = 5;
    COMMIT;
  `);
}

function createAgentTables(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE agent_runs (run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')), request TEXT NOT NULL CHECK (json_valid(request)), started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER, signal TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX agent_runs_session_status ON agent_runs(session_id, status);
    CREATE TABLE agent_events (run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE, sequence INTEGER NOT NULL CHECK (sequence > 0), session_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('started', 'stdout', 'stderr', 'completed', 'failed', 'cancelled', 'interrupted')), data TEXT, exit_code INTEGER, signal TEXT, created_at TEXT NOT NULL, PRIMARY KEY (run_id, sequence));
    CREATE INDEX agent_events_run_sequence ON agent_events(run_id, sequence);
    PRAGMA user_version = 4;
    COMMIT;
  `);
}

function createRevisionEvents(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS revision_events (revision INTEGER PRIMARY KEY CHECK (revision >= 0), resource TEXT, resource_id TEXT);
    CREATE INDEX IF NOT EXISTS revision_events_revision ON revision_events(revision);
    PRAGMA user_version = 6;
    COMMIT;
  `);
}
