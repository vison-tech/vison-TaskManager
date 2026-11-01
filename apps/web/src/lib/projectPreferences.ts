import type { Status } from '../../../../packages/contracts/index.ts';

import { defaultProjectPreferences } from '../../../../packages/contracts/preferences.ts';
import type { CardDisplayPreferences, ProjectPreferences, ProjectView } from '../../../../packages/contracts/preferences.ts';
export { defaultProjectPreferences } from '../../../../packages/contracts/preferences.ts';
export type { CardDisplayPreferences, ProjectPreferences, ProjectView } from '../../../../packages/contracts/preferences.ts';

export const projectPreferencesKey = 'taskmanager.project-preferences.v1';

const views = new Set<ProjectView>(['board', 'list', 'dashboard', 'timeline']);
const statuses = new Set<Status | 'all'>(['all', 'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled']);

export function parseProjectPreferences(raw: string | null): Record<string, ProjectPreferences> {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).flatMap(([projectId, value]) => {
      if (!projectId || !value || typeof value !== 'object' || Array.isArray(value)) return [];
      const item = value as Partial<ProjectPreferences>;
      const cardDisplay = item.cardDisplay && typeof item.cardDisplay === 'object' && !Array.isArray(item.cardDisplay)
        ? item.cardDisplay as Partial<CardDisplayPreferences>
        : {};
      const preference: ProjectPreferences = {
        view: views.has(item.view as ProjectView) ? item.view as ProjectView : defaultProjectPreferences.view,
        status: statuses.has(item.status as Status | 'all') ? item.status as Status | 'all' : defaultProjectPreferences.status,
        showArchived: item.showArchived === true,
        search: typeof item.search === 'string' ? item.search.slice(0, 500) : defaultProjectPreferences.search,
        cardDisplay: {
          description: cardDisplay.description !== false,
          labels: cardDisplay.labels !== false,
          dueDate: cardDisplay.dueDate !== false,
          assignee: cardDisplay.assignee !== false,
          sessions: cardDisplay.sessions !== false,
        },
      };
      return [[projectId, preference]] as const;
    }));
  } catch {
    return {};
  }
}

export function readProjectPreferences(raw: string | null, projectId: string): ProjectPreferences {
  return parseProjectPreferences(raw)[projectId] ?? defaultProjectPreferences;
}

export function writeProjectPreferences(raw: string | null, projectId: string, preferences: Omit<ProjectPreferences, 'cardDisplay'> & { cardDisplay?: Partial<CardDisplayPreferences> }): string {
  const current = parseProjectPreferences(raw);
  const cardDisplay = preferences.cardDisplay ?? defaultProjectPreferences.cardDisplay;
  current[projectId] = {
    view: views.has(preferences.view) ? preferences.view : defaultProjectPreferences.view,
    status: statuses.has(preferences.status) ? preferences.status : defaultProjectPreferences.status,
    showArchived: preferences.showArchived === true,
    search: preferences.search.slice(0, 500),
    cardDisplay: {
      description: cardDisplay.description !== false,
      labels: cardDisplay.labels !== false,
      dueDate: cardDisplay.dueDate !== false,
      assignee: cardDisplay.assignee !== false,
      sessions: cardDisplay.sessions !== false,
    },
  };
  const entries = Object.entries(current).slice(-20);
  return JSON.stringify(Object.fromEntries(entries));
}
