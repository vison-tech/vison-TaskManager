import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import type { Status, Task } from '../../../../packages/contracts/index.ts';
import { priorityLabels, statuses, statusLabels } from '../../../../packages/contracts/index.ts';
import { formatDate, initial } from '../lib/format';
import { StatusDot } from './shared';
import { priorityLabelsEn, statusLabelsEn, useLocale } from '../lib/locale';
import type { CardDisplayPreferences } from '../lib/projectPreferences';

const statusOrder = statuses;

export function Board({ tasks, display, onOpenTask, onMoveTask, onReorderTask, onCreate }: { tasks: Task[]; display: CardDisplayPreferences; onOpenTask: (id: string) => void; onMoveTask: (task: Task, direction: -1 | 1) => Promise<void>; onReorderTask: (task: Task, direction: -1 | 1) => Promise<void>; onCreate: (status?: Status) => void }) {
  const { text } = useLocale();
  return <section className="board" aria-label={text('任务看板', 'Task board')}>{statusOrder.map((status) => <StatusColumn key={status} status={status} tasks={tasks.filter((task) => task.status === status)} display={display} onOpenTask={onOpenTask} onMoveTask={onMoveTask} onReorderTask={onReorderTask} onCreate={onCreate} />)}</section>;
}

function StatusColumn({ status, tasks, display, onOpenTask, onMoveTask, onReorderTask, onCreate }: { status: Status; tasks: Task[]; display: CardDisplayPreferences; onOpenTask: (id: string) => void; onMoveTask: (task: Task, direction: -1 | 1) => Promise<void>; onReorderTask: (task: Task, direction: -1 | 1) => Promise<void>; onCreate: (status?: Status) => void }) {
  const { locale, text } = useLocale();
  const label = locale === 'en' ? statusLabelsEn[status] : statusLabels[status];
  const { isOver, setNodeRef } = useDroppable({ id: `column:${status}`, data: { status } });
  return <section ref={setNodeRef} className={`board-column ${isOver ? 'drop-target' : ''}`} aria-label={label}><header className="column-header"><div className="column-title"><StatusDot status={status} /><span>{label}</span><span className="column-count">{tasks.length}</span></div><button className="icon-button tiny" title={text(`在${statusLabels[status]}中新建`, `Create in ${label}`)} aria-label={text(`在${statusLabels[status]}中新建`, `Create in ${label}`)} onClick={() => onCreate(status)}><MoreHorizontal size={15} /></button></header><div className="column-tasks">{tasks.length === 0 ? <div className="column-empty">{text('拖动任务到这里', 'Drop tasks here')}</div> : tasks.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((task) => <TaskCard key={task.id} task={task} display={display} onOpen={() => onOpenTask(task.id)} onMove={(direction) => onMoveTask(task, direction)} onReorder={(direction) => onReorderTask(task, direction)} />)}</div><div className="column-footer"><button className="add-task-button" onClick={() => onCreate(status)}><Plus size={15} />{text('添加任务', 'Add task')}</button></div></section>;
}

function TaskCard({ task, display, onOpen, onMove, onReorder }: { task: Task; display: CardDisplayPreferences; onOpen: () => void; onMove: (direction: -1 | 1) => Promise<void>; onReorder: (direction: -1 | 1) => Promise<void> }) {
  const { locale, text } = useLocale();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { taskId: task.id, status: task.status } });
  const { setNodeRef: setDropRef } = useDroppable({ id: `task:${task.id}`, data: { taskId: task.id, status: task.status }, disabled: isDragging });
  return <article ref={(node) => { setNodeRef(node); setDropRef(node); }} style={{ transform: CSS.Translate.toString(transform) }} className={`task-card ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners} onClick={onOpen} tabIndex={0} aria-label={`${task.identifier} ${task.title}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space" onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } else if (event.key === 'ArrowRight') { event.preventDefault(); void onMove(1); } else if (event.key === 'ArrowLeft') { event.preventDefault(); void onMove(-1); } else if (event.key === 'ArrowUp') { event.preventDefault(); void onReorder(-1); } else if (event.key === 'ArrowDown') { event.preventDefault(); void onReorder(1); } }}><div className="task-card-top"><span className="task-id">{task.identifier}</span><span className={`priority priority-${task.priority}`}>{locale === 'en' ? priorityLabelsEn[task.priority] : priorityLabels[task.priority]}</span><button className="card-menu" aria-label={text('任务操作', 'Task actions')} onClick={(event) => event.stopPropagation()}><MoreHorizontal size={15} /></button></div><h3>{task.title}</h3>{display.description && task.description && <p className="task-excerpt">{task.description.replace(/[#*_`\n]/g, ' ').trim()}</p>}<div className="task-card-bottom">{display.labels && task.labels.length > 0 && <span className="label-chip">{task.labels[0]}{task.labels.length > 1 && ` +${task.labels.length - 1}`}</span>}{display.dueDate && task.dueDate && <span className="due-date">{formatDate(task.dueDate)}</span>}{display.assignee && task.assignee && <span className="assignee" title={task.assignee}>{initial(task.assignee)}</span>}{display.sessions && task.sessions.length > 0 && <span className="session-count"><Sparkles size={12} />{task.sessions.length}</span>}</div></article>;
}
