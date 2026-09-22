import type { Task } from '../../../../packages/contracts/index.ts';

export function formatDate(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function initial(value: string) { return value.trim().slice(0, 1).toUpperCase() || '?'; }
export function matchesSearch(task: Task, value: string) { const needle = value.trim().toLowerCase(); return !needle || [task.identifier, task.title, task.description, task.assignee, ...task.labels].join(' ').toLowerCase().includes(needle); }
export function activityLabel(action: string) { const labels: Record<string, string> = { 'task.created': '创建了任务', 'task.updated': '更新了任务', 'comment.created': '添加了评论', 'comment.updated': '编辑了评论', 'comment.deleted': '删除了评论', 'attachment.created': '上传了附件', 'attachment.deleted': '删除了附件', 'relation.created': '添加了任务关联', 'relation.deleted': '删除了任务关联', 'session.created': '关联了 Agent 会话', 'session.deleted': '移除了 Agent 会话' }; return labels[action] ?? action; }
