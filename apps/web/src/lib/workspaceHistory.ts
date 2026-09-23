export interface WorkspaceHistory {
  recentProjectIds: string[];
  readRevision: number | null;
}

export const workspaceHistoryKey = 'taskmanager.workspace-history.v1';
export const emptyWorkspaceHistory: WorkspaceHistory = { recentProjectIds: [], readRevision: null };

export function parseWorkspaceHistory(raw: string | null): WorkspaceHistory {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return emptyWorkspaceHistory;
    const candidate = value as Partial<WorkspaceHistory>;
    return {
      recentProjectIds: Array.isArray(candidate.recentProjectIds)
        ? [...new Set(candidate.recentProjectIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 5)
        : [],
      readRevision: Number.isSafeInteger(candidate.readRevision) && candidate.readRevision! >= 0 ? candidate.readRevision! : null,
    };
  } catch { return emptyWorkspaceHistory; }
}

export function visitProject(history: WorkspaceHistory, projectId: string): WorkspaceHistory {
  if (history.recentProjectIds[0] === projectId) return history;
  return { ...history, recentProjectIds: [projectId, ...history.recentProjectIds.filter((id) => id !== projectId)].slice(0, 5) };
}

export function unreadUpdates(history: WorkspaceHistory, revision?: number): number {
  if (revision === undefined || history.readRevision === null) return 0;
  return Math.max(0, revision - history.readRevision);
}
