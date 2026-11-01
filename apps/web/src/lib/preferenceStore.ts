import {
  defaultGlobalEmbeddedPreferences, defaultProjectPreferences, embeddedPreferences, embeddedPreferencesPatch,
  type EmbeddedPreferences, type EmbeddedPreferencesPatch, type GlobalEmbeddedPreferences, type ProjectPreferenceChanges,
} from '../../../../packages/contracts/preferences.ts';

export interface PreferenceSnapshot {
  preferences: EmbeddedPreferences;
  status: 'loading' | 'saved' | 'saving' | 'error';
  error: string | null;
  notice?: string | null;
}
export interface EmbeddedPreferencesStore {
  getSnapshot(): PreferenceSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  patchGlobal(changes: Partial<GlobalEmbeddedPreferences>): void;
  patchProject(id: string, changes: ProjectPreferenceChanges): void;
  retry(): Promise<void>;
  flush(): Promise<void>;
}
export interface PreferenceTransport {
  getEmbeddedPreferences(): Promise<EmbeddedPreferences>;
  patchEmbeddedPreferences(patch: EmbeddedPreferencesPatch): Promise<EmbeddedPreferences>;
}

function apply(current: EmbeddedPreferences, patch: EmbeddedPreferencesPatch): EmbeddedPreferences {
  const next = { global: { ...current.global, ...patch.global }, projects: { ...current.projects } };
  if (patch.project) {
    const { id, changes } = patch.project;
    const previous = next.projects[id] ?? defaultProjectPreferences;
    next.projects[id] = { ...previous, ...changes, cardDisplay: { ...previous.cardDisplay, ...changes.cardDisplay } };
  }
  return next;
}

function merge(previous: EmbeddedPreferencesPatch, next: EmbeddedPreferencesPatch): EmbeddedPreferencesPatch {
  if (next.global) return { global: { ...previous.global, ...next.global } };
  const before = previous.project?.changes ?? {}, after = next.project!.changes;
  return { project: { id: next.project!.id, changes: { ...before, ...after, ...((before.cardDisplay || after.cardDisplay) ? { cardDisplay: { ...before.cardDisplay, ...after.cardDisplay } } : {}) } } };
}

/** Optimistic preferences with serialized field patches; defaults are never written after a failed read. */
export function createEmbeddedPreferencesStore(transport: PreferenceTransport, debounceMs = 150): EmbeddedPreferencesStore {
  let base: EmbeddedPreferences = { global: { ...defaultGlobalEmbeddedPreferences }, projects: {} };
  let state: PreferenceSnapshot = { preferences: base, status: 'loading', error: null };
  const listeners = new Set<() => void>();
  const queue = new Map<string, EmbeddedPreferencesPatch>();
  let loaded = false, refreshing = false, initializing: Promise<void> | null = null, draining: Promise<void> | null = null, retrying: Promise<void> | null = null;
  let notice: string | null = null;
  let inFlight: EmbeddedPreferencesPatch | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const keyOf = (patch: EmbeddedPreferencesPatch) => patch.project ? `project:${patch.project.id}` : 'global';
  const publish = (status: PreferenceSnapshot['status'], error: string | null = null) => {
    let preferences = inFlight ? apply(base, inFlight) : base;
    for (const patch of queue.values()) preferences = apply(preferences, patch);
    state = { preferences, status, error, notice };
    for (const listener of listeners) listener();
  };
  const failure = (reading: boolean) => publish('error', reading
    ? '未能读取已保存的偏好，当前修改暂存于此面板。请确认本地服务已更新，再重试。'
    : '偏好尚未保存到本机，当前面板仍可使用。请重试保存。');

  async function drain(): Promise<void> {
    if (!loaded || refreshing || state.status === 'error') return;
    if (draining) return draining;
    draining = (async () => {
      while (queue.size) {
        const [key, patch] = queue.entries().next().value!;
        queue.delete(key); inFlight = patch; publish('saving');
        try {
          base = embeddedPreferences.parse(await transport.patchEmbeddedPreferences(patch));
          inFlight = null;
          publish(queue.size ? 'saving' : 'saved');
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PROJECT_NOT_FOUND') {
            // Deleted project settings cannot be retried. Keep every unrelated pending field.
            const removed = patch.project?.id ?? patch.global?.projectId;
            if (removed) {
              queue.delete(`project:${removed}`);
              const projects = { ...base.projects }; delete projects[removed];
              base = { global: { ...base.global, ...(base.global.projectId === removed ? { projectId: null } : {}) }, projects };
              const newer = queue.get('global');
              if (patch.global) {
                const global = { ...patch.global, ...newer?.global };
                if (global.projectId === removed) delete global.projectId;
                queue.delete('global');
                if (Object.keys(global).length) queue.set('global', { global });
              } else if (newer?.global?.projectId === removed) {
                const global = { ...newer.global }; delete global.projectId;
                if (Object.keys(global).length) queue.set('global', { global }); else queue.delete('global');
              }
              notice = '已移除不存在项目的待保存偏好，其他设置仍会继续保存。';
              inFlight = null; publish(queue.size ? 'saving' : 'saved');
              continue;
            }
          }
          // Newer edits to the same fields win, while the failed patch remains retryable.
          const newer = queue.get(key);
          queue.delete(key);
          const remainder = [...queue.entries()]; queue.clear();
          queue.set(key, newer ? merge(patch, newer) : patch);
          for (const [otherKey, value] of remainder) queue.set(otherKey, value);
          inFlight = null; failure(false); break;
        }
      }
    })().finally(() => { draining = null; });
    return draining;
  }
  function schedule() {
    if (!loaded || refreshing || state.status === 'error') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void drain(); }, debounceMs);
  }
  function enqueue(raw: EmbeddedPreferencesPatch) {
    const patch = embeddedPreferencesPatch.parse(raw);
    // Ignore no-op effects without replacing existing fields in another window.
    if (loaded && state.status !== 'error' && JSON.stringify(apply(state.preferences, patch)) === JSON.stringify(state.preferences)) return;
    const key = keyOf(patch), previous = queue.get(key);
    queue.set(key, previous ? merge(previous, patch) : patch);
    publish(state.status === 'error' ? 'error' : 'saving', state.error);
    schedule();
  }
  async function initialize() {
    if (loaded) return;
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        base = embeddedPreferences.parse(await transport.getEmbeddedPreferences()); loaded = true;
        publish(queue.size ? 'saving' : 'saved');
        await drain();
      } catch { failure(true); }
    })().finally(() => { initializing = null; });
    return initializing;
  }
  async function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (retrying) { await retrying; return; }
    if (!loaded) await initialize();
    await drain();
  }
  function retry(): Promise<void> {
    if (retrying) return retrying;
    retrying = (async () => {
      if (!loaded) { await initialize(); return; }
      if (draining) await draining;
      refreshing = true;
      try {
        base = embeddedPreferences.parse(await transport.getEmbeddedPreferences());
        notice = null;
        refreshing = false;
        publish(queue.size ? 'saving' : 'saved');
        if (timer) { clearTimeout(timer); timer = undefined; }
        await drain();
      } catch { failure(true); }
      finally { refreshing = false; }
    })().finally(() => { retrying = null; });
    return retrying;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize,
    patchGlobal(changes) { enqueue({ global: changes }); },
    patchProject(id, changes) { enqueue({ project: { id, changes } }); },
    retry,
    flush,
  };
}
