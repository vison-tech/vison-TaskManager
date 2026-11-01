import { z } from 'zod';
import { statuses } from './values.ts';

export const embeddedPreferencesPath = '/api/v1/preferences/codex';
export const themePreference = z.enum(['light', 'dark', 'host']);
export const cardDisplayPreferences = z.object({ description: z.boolean(), labels: z.boolean(), dueDate: z.boolean(), assignee: z.boolean(), sessions: z.boolean() }).strict();
export const projectViewPreferences = z.object({
  view: z.enum(['board', 'list', 'dashboard', 'timeline']),
  status: z.enum(['all', ...statuses]),
  showArchived: z.boolean(),
  search: z.string().max(500),
  cardDisplay: cardDisplayPreferences,
}).strict();
export const globalEmbeddedPreferences = z.object({
  theme: themePreference,
  locale: z.enum(['zh', 'en']),
  projectId: z.string().uuid().nullable(),
}).strict();
export const projectPreferenceChanges = projectViewPreferences.omit({ cardDisplay: true }).partial().extend({ cardDisplay: cardDisplayPreferences.partial().optional() }).strict();
export const embeddedPreferencesPatch = z.object({
  global: globalEmbeddedPreferences.partial().optional(),
  project: z.object({ id: z.string().uuid(), changes: projectPreferenceChanges }).strict().optional(),
}).strict().refine((value) => value.global !== undefined || value.project !== undefined, 'At least one preference change is required');
export const embeddedPreferences = z.object({
  global: globalEmbeddedPreferences,
  projects: z.record(z.string().uuid(), projectViewPreferences),
}).strict();
export type ThemePreference = z.infer<typeof themePreference>;
export type CardDisplayPreferences = z.infer<typeof cardDisplayPreferences>;
export type ProjectPreferences = z.infer<typeof projectViewPreferences>;
export type ProjectView = ProjectPreferences['view'];
export type GlobalEmbeddedPreferences = z.infer<typeof globalEmbeddedPreferences>;
export type EmbeddedPreferences = z.infer<typeof embeddedPreferences>;
export type EmbeddedPreferencesPatch = z.infer<typeof embeddedPreferencesPatch>;
export type ProjectPreferenceChanges = z.infer<typeof projectPreferenceChanges>;
export const defaultGlobalEmbeddedPreferences: GlobalEmbeddedPreferences = { theme: 'host', locale: 'zh', projectId: null };
export const defaultProjectPreferences: ProjectPreferences = {
  view: 'board', status: 'all', showArchived: false, search: '',
  cardDisplay: { description: true, labels: true, dueDate: true, assignee: true, sessions: true },
};
