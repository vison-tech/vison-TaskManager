import { useSyncExternalStore } from 'react';
import { TaskClient } from '../../../../packages/client/index.ts';
import { embeddedRuntime, webBaseUrl } from './embedded';
import { createEmbeddedPreferencesStore, type EmbeddedPreferencesStore } from './preferenceStore';

export { createEmbeddedPreferencesStore } from './preferenceStore';
export type { EmbeddedPreferencesStore, PreferenceSnapshot } from './preferenceStore';
// Preference failure is recoverable; it must finish before the parent panel's loading deadline.
export const embeddedPreferencesStore = embeddedRuntime ? createEmbeddedPreferencesStore(new TaskClient({ baseUrl: webBaseUrl, actor: 'web-user', timeoutMs: 3000 })) : null;
const empty = () => null;
const noopSubscribe = () => () => {};
export function useEmbeddedPreferences(store: EmbeddedPreferencesStore | null = embeddedPreferencesStore) {
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? empty, empty);
}
