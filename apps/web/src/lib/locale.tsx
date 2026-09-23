import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';
import type { Priority, Status } from '../../../../packages/contracts/index.ts';
type LocaleContextValue = { locale: Locale; toggleLocale: () => void; text: (zh: string, en: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);
const storageKey = 'taskmanager.locale';

function readLocale(): Locale {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readLocale);
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    try { localStorage.setItem(storageKey, locale); } catch { /* Keep the preference in memory when storage is unavailable. */ }
  }, [locale]);
  const value = useMemo<LocaleContextValue>(() => ({ locale, toggleLocale: () => setLocale((current) => current === 'zh' ? 'en' : 'zh'), text: (zh, en) => locale === 'zh' ? zh : en }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

export const statusLabelsEn: Record<Status, string> = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done', canceled: 'Canceled' };
export const priorityLabelsEn: Record<Priority, string> = { none: 'No priority', urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
