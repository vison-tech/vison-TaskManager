import { useEffect, useState } from 'react';
import { emptyWorkspaceHistory, parseWorkspaceHistory, unreadUpdates, visitProject, workspaceHistoryKey } from '../lib/workspaceHistory';

export function useWorkspaceHistory(projectId?: string, revision?: number) {
  const [history, setHistory] = useState(() => {
    try { return parseWorkspaceHistory(localStorage.getItem(workspaceHistoryKey)); }
    catch { return emptyWorkspaceHistory; }
  });

  useEffect(() => {
    if (projectId) setHistory((current) => visitProject(current, projectId));
  }, [projectId]);

  useEffect(() => {
    if (revision === undefined) return;
    setHistory((current) => current.readRevision === null || current.readRevision > revision
      ? { ...current, readRevision: revision } : current);
  }, [revision]);

  useEffect(() => {
    try { localStorage.setItem(workspaceHistoryKey, JSON.stringify(history)); }
    catch { /* Storage may be disabled; keep this session usable. */ }
  }, [history]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === workspaceHistoryKey || event.key === null) setHistory(parseWorkspaceHistory(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return {
    recentProjectIds: history.recentProjectIds,
    unreadCount: unreadUpdates(history, revision),
    markRead: () => {
      if (revision !== undefined) setHistory((current) => ({ ...current, readRevision: revision }));
    },
  };
}
