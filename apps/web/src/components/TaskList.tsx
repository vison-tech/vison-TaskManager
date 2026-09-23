import { useState, type FormEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { Task, TaskPatch } from '../../../../packages/contracts/index.ts';
import { priorityLabels, priorities, statuses, statusLabels } from '../../../../packages/contracts/index.ts';
import { formatDate } from '../lib/format';
import { StatusDot } from './shared';
import { priorityLabelsEn, statusLabelsEn, useLocale } from '../lib/locale';

type Draft = Pick<Task, 'title' | 'status' | 'priority' | 'dueDate' | 'assignee'>;

export function TaskList({ tasks, onOpenTask, onUpdate }: { tasks: Task[]; onOpenTask: (id: string) => void; onUpdate: (task: Task, input: Partial<TaskPatch>) => Promise<boolean | void> }) {
  const { locale, text } = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  function beginEdit(task: Task) {
    setEditingId(task.id);
    setDraft({ title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate, assignee: task.assignee });
  }

  function cancelEdit() { setEditingId(null); setDraft(null); }

  async function saveEdit(event: FormEvent, task: Task) {
    event.preventDefault();
    if (!draft || !draft.title.trim()) return;
    const saved = await onUpdate(task, { ...draft, title: draft.title.trim() });
    if (saved !== false) cancelEdit();
  }

  const ordered = statuses.flatMap((status) => tasks.filter((task) => task.status === status).sort((a, b) => a.sortOrder - b.sortOrder));
  return <section className="task-list"><div className="list-head"><span>{text('任务', 'Task')}</span><span>{text('状态', 'Status')}</span><span>{text('优先级', 'Priority')}</span><span>{text('截止日期', 'Due date')}</span><span>{text('负责人', 'Assignee')}</span><span /></div>{ordered.length === 0 ? <div className="list-empty">{text('列表为空', 'List is empty')}</div> : ordered.map((task) => editingId === task.id && draft ? <form className="list-row list-row-editing" key={task.id} onSubmit={(event) => void saveEdit(event, task)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); } }}>
    <span className="list-title"><span className="task-id">{task.identifier}</span><input autoFocus aria-label={text('任务标题', 'Task title')} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></span>
    <select aria-label={text('任务状态', 'Task status')} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Task['status'] })}>{statuses.map((status) => <option key={status} value={status}>{locale === 'en' ? statusLabelsEn[status] : statusLabels[status]}</option>)}</select>
    <select aria-label={text('任务优先级', 'Task priority')} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task['priority'] })}>{priorities.map((priority) => <option key={priority} value={priority}>{locale === 'en' ? priorityLabelsEn[priority] : priorityLabels[priority]}</option>)}</select>
    <input aria-label="截止日期" type="date" value={draft.dueDate ?? ''} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value || null })} />
    <input aria-label="负责人" value={draft.assignee} onChange={(event) => setDraft({ ...draft, assignee: event.target.value })} />
    <span className="list-edit-actions"><button className="icon-button tiny" title={text('保存修改', 'Save changes')} aria-label={text('保存修改', 'Save changes')} disabled={!draft.title.trim()}><Check size={14} /></button><button type="button" className="icon-button tiny" title={text('取消编辑', 'Cancel edit')} aria-label={text('取消编辑', 'Cancel edit')} onClick={cancelEdit}><X size={14} /></button></span>
  </form> : <div className="list-row" key={task.id} role="button" tabIndex={0} aria-keyshortcuts="Enter Space" onClick={() => onOpenTask(task.id)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenTask(task.id); } }}><span className="list-title"><span className="task-id">{task.identifier}</span><strong>{task.title}</strong></span><span className="list-status"><StatusDot status={task.status} />{locale === 'en' ? statusLabelsEn[task.status] : statusLabels[task.status]}</span><span className={`priority priority-${task.priority}`}>{locale === 'en' ? priorityLabelsEn[task.priority] : priorityLabels[task.priority]}</span><span>{formatDate(task.dueDate) || '—'}</span><span>{task.assignee || text('未分配', 'Unassigned')}</span><button className="icon-button tiny list-edit-button" title={text('行内编辑', 'Edit inline')} aria-label={text('行内编辑', 'Edit inline')} onClick={(event) => { event.stopPropagation(); beginEdit(task); }}><Pencil size={14} /></button></div>)}</section>;
}
