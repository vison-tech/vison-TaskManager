import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

export function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version ?? 0);
  if (version > 1) throw new Error(`Unsupported database schema version ${version}`);
  if (version === 1) return;
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
