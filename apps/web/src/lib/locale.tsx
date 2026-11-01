import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';
import type { Priority, Status } from '../../../../packages/contracts/index.ts';
import { embeddedPreferencesStore, useEmbeddedPreferences, type EmbeddedPreferencesStore } from './embeddedPreferences';
type LocaleContextValue = { locale: Locale; toggleLocale: () => void; text: (zh: string, en: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);
const storageKey = 'taskmanager.locale';

function readLocale(): Locale {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}

export function LocaleProvider({ children, preferenceStore = embeddedPreferencesStore }: { children: ReactNode; preferenceStore?: EmbeddedPreferencesStore | null }) {
  const preferences = useEmbeddedPreferences(preferenceStore);
  const [browserLocale, setLocale] = useState<Locale>(() => preferenceStore ? 'zh' : readLocale());
  const locale = preferences?.preferences.global.locale ?? browserLocale;
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    if (!preferenceStore) { try { localStorage.setItem(storageKey, locale); } catch { /* Keep the preference in memory when storage is unavailable. */ } }
  }, [locale, preferenceStore]);
  const value = useMemo<LocaleContextValue>(() => ({ locale, toggleLocale: () => {
    if (preferenceStore) preferenceStore.patchGlobal({ locale: locale === 'zh' ? 'en' : 'zh' });
    else setLocale((current) => current === 'zh' ? 'en' : 'zh');
  }, text: (zh, en) => locale === 'zh' ? zh : en }), [locale, preferenceStore]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

export const statusLabelsEn: Record<Status, string> = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done', canceled: 'Canceled' };
export const priorityLabelsEn: Record<Priority, string> = { none: 'No priority', urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
