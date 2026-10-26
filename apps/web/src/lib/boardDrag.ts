import type { Status, Task, TaskPatch } from '../../../../packages/contracts/index.ts';
import { statuses } from '../../../../packages/contracts/index.ts';

export interface BoardDropTarget {
  status?: Status;
  taskId?: string;
}

/**
 * Computes the optimistic write a drop should issue. The target card's column supplies the status
 * when the drop lands on a card; a drop on the column itself keeps the target card's status.
 * `sortOrder` slots between the card above the landing point and the landing card, so an edit
 * that lands between two siblings never collides with either order value.
 */
export function planBoardDrop(
  dragged: Task | null,
  visibleTasks: Task[],
  over: { data?: { current?: BoardDropTarget } } | null,
): { status?: Status; sortOrder?: number } | null {
  if (!dragged || !over) return null;
  const overData = over.data?.current;
  const targetStatus = overData?.status ?? visibleTasks.find((task) => task.id === overData?.taskId)?.status;
  if (!targetStatus) return null;
  const targetId = overData?.taskId;
  if (targetStatus === dragged.status && targetId === dragged.id) return null;
  const sameColumn = visibleTasks
    .filter((task) => task.status === targetStatus && task.id !== dragged.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const targetIndex = targetId ? Math.max(0, sameColumn.findIndex((task) => task.id === targetId)) : sameColumn.length;
  const previous = sameColumn[targetIndex - 1];
  const target = sameColumn[targetIndex];
  const sortOrder = target ? (previous ? (previous.sortOrder + target.sortOrder) / 2 : target.sortOrder - 1) : (previous?.sortOrder ?? -1) + 1;
  return { status: targetStatus, sortOrder };
}

/**
 * Keyboard state move: step one column in `direction` and append to that column's end.
 * Returns undefined when there is no neighboring column; the caller then does nothing.
 */
export function planBoardKeyboardMove(tasks: Task[], task: Task, direction: -1 | 1): Partial<TaskPatch> | undefined {
  const currentIndex = statuses.indexOf(task.status);
  const nextStatus = statuses[currentIndex + direction];
  if (!nextStatus) return undefined;
  const nextTasks = tasks.filter((item) => item.projectId === task.projectId && item.status === nextStatus && !item.archivedAt);
  const nextSortOrder = nextTasks.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
  return { status: nextStatus, sortOrder: nextSortOrder };
}

/**
 * Keyboard reorder within the current column: insert between the target sibling and its neighbor in
 * `direction`; at the column end the task appends one step past the last order value. Pressing up
 * on the first card or down on the last card has no neighbor, so no move is planned.
 */
export function planBoardKeyboardReorder(tasks: Task[], task: Task, direction: -1 | 1): Partial<TaskPatch> | undefined {
  const siblings = tasks
    .filter((item) => item.projectId === task.projectId && item.status === task.status && !item.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex((item) => item.id === task.id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return undefined;
  const target = siblings[targetIndex];
  const neighbor = siblings[targetIndex + direction];
  const sortOrder = neighbor ? (target.sortOrder + neighbor.sortOrder) / 2 : target.sortOrder + direction;
  return { sortOrder };
}
