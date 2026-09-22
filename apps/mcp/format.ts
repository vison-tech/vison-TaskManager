import { statusLabels, type Task, type TaskDetail } from '../../packages/contracts/index.ts';

export function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

export function taskSummary(task: Task) {
  return { id: task.id, identifier: task.identifier, projectId: task.projectId, title: task.title, status: task.status, statusLabel: statusLabels[task.status], priority: task.priority, labels: task.labels, assignee: task.assignee, dueDate: task.dueDate, archivedAt: task.archivedAt, version: task.version, sessions: task.sessions };
}

export function detailSummary(detail: TaskDetail) {
  return { ...taskSummary(detail.task), description: detail.task.description, startDate: detail.task.startDate, recurrence: detail.task.recurrence, comments: detail.comments, activities: detail.activities, attachments: detail.attachments, relations: detail.relations };
}
