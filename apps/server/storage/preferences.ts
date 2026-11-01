import type { DatabaseSync } from 'node:sqlite';
import {
  defaultGlobalEmbeddedPreferences, defaultProjectPreferences, embeddedPreferencesPatch,
  globalEmbeddedPreferences, projectViewPreferences,
  type EmbeddedPreferences, type EmbeddedPreferencesPatch,
} from '../../../packages/contracts/preferences.ts';
import { fail } from '../validation.ts';

type Row = Record<string, unknown>;

/** Device-local Codex UI state. It does not alter task versions or the business revision stream. */
export class EmbeddedPreferenceStore {
  constructor(private readonly db: DatabaseSync) {}

  read(): EmbeddedPreferences {
    const global = this.db.prepare('SELECT theme, locale, project_id FROM embedded_preferences WHERE scope=?').get('codex') as Row | undefined;
    const projects = this.db.prepare('SELECT project_id, value FROM embedded_project_preferences WHERE scope=? ORDER BY project_id').all('codex') as Row[];
    return {
      global: global ? globalEmbeddedPreferences.parse({ theme: global.theme, locale: global.locale, projectId: global.project_id }) : { ...defaultGlobalEmbeddedPreferences },
      projects: Object.fromEntries(projects.map((row) => [String(row.project_id), projectViewPreferences.parse(JSON.parse(String(row.value)))])),
    };
  }

  patch(input: EmbeddedPreferencesPatch): EmbeddedPreferences {
    const patch = embeddedPreferencesPatch.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (patch.global?.projectId) this.requireProject(patch.global.projectId);
      if (patch.project) this.requireProject(patch.project.id);
      const previous = this.read();
      if (patch.global) {
        const next = globalEmbeddedPreferences.parse({ ...previous.global, ...patch.global });
        this.db.prepare(`INSERT INTO embedded_preferences(scope, theme, locale, project_id) VALUES ('codex', ?, ?, ?)
          ON CONFLICT(scope) DO UPDATE SET theme=excluded.theme, locale=excluded.locale, project_id=excluded.project_id`).run(next.theme, next.locale, next.projectId);
      }
      if (patch.project) {
        const { id, changes } = patch.project;
        const before = previous.projects[id] ?? defaultProjectPreferences;
        const next = projectViewPreferences.parse({ ...before, ...changes, cardDisplay: { ...before.cardDisplay, ...changes.cardDisplay } });
        this.db.prepare(`INSERT INTO embedded_project_preferences(scope, project_id, value) VALUES ('codex', ?, ?)
          ON CONFLICT(scope, project_id) DO UPDATE SET value=excluded.value`).run(id, JSON.stringify(next));
      }
      const result = this.read();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private requireProject(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) fail(404, 'PROJECT_NOT_FOUND', 'The preference project no longer exists.');
  }
}
