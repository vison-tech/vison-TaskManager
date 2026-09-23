export const activityReadKey = (taskId: string) => `taskmanager.activity-read:${taskId}`;

export function readActivityMarker(raw: string | null): string | null {
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

export function unreadActivityCount(createdAt: string[], readAt: string | null): number {
  if (!readAt) return 0;
  return createdAt.filter((value) => value > readAt).length;
}
