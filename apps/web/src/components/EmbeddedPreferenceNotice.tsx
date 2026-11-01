import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { embeddedPreferencesStore, useEmbeddedPreferences, type EmbeddedPreferencesStore } from '../lib/embeddedPreferences';
import { useLocale } from '../lib/locale';

export function EmbeddedPreferenceNotice({ store = embeddedPreferencesStore }: { store?: EmbeddedPreferencesStore | null }) {
  const state = useEmbeddedPreferences(store);
  const { locale, text } = useLocale();
  const [retrying, setRetrying] = useState(false);
  if (!store || !state) return null;
  if (state.status !== 'error') return state.status === 'saving' || state.notice ? <p className="muted-copy" role="status">{state.notice ? locale === 'zh' ? state.notice : 'Saved preferences were adjusted to match the available projects.' : text('正在保存偏好…', 'Saving preferences…')}</p> : null;
  async function retry() {
    if (retrying || !store) return;
    setRetrying(true);
    try { await store.retry(); } finally { setRetrying(false); }
  }
  return <div className="notice error" role="alert">
    <span>{locale === 'zh' && state.error ? state.error : text('偏好尚未保存到本机，当前修改仍保留在面板中。', 'Preferences could not be loaded or saved locally. Your changes remain in this panel. Retry when the local service is available.')}</span>
    <button type="button" className="button secondary" onClick={() => void retry()} disabled={retrying}><RotateCcw size={14} />{retrying ? text('正在重试…', 'Retrying…') : text('重试保存偏好', 'Retry saving preferences')}</button>
  </div>;
}
