import type { Task } from '../../../../packages/contracts/index.ts';
import { priorityLabels, statuses, statusLabels } from '../../../../packages/contracts/index.ts';
import { formatDate } from '../lib/format';
import { StatusDot } from './shared';

export function TaskList({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (id: string) => void }) {
  return <section className="task-list"><div className="list-head"><span>任务</span><span>状态</span><span>优先级</span><span>截止日期</span><span>负责人</span></div>{tasks.length === 0 ? <div className="list-empty">列表为空</div> : statuses.flatMap((status) => tasks.filter((task) => task.status === status).sort((a, b) => a.sortOrder - b.sortOrder)).map((task) => <button className="list-row" key={task.id} onClick={() => onOpenTask(task.id)}><span className="list-title"><span className="task-id">{task.identifier}</span><strong>{task.title}</strong></span><span className="list-status"><StatusDot status={task.status} />{statusLabels[task.status]}</span><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span>{formatDate(task.dueDate) || '—'}</span><span>{task.assignee || '未分配'}</span></button>)}</section>;
}
