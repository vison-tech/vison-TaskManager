import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import type { Status, Task } from '../../../../packages/contracts/index.ts';
import { priorityLabels, statuses, statusLabels } from '../../../../packages/contracts/index.ts';
import { formatDate, initial } from '../lib/format';
import { StatusDot } from './shared';

const statusOrder = statuses;

export function Board({ tasks, onOpenTask, onMoveTask, onCreate }: { tasks: Task[]; onOpenTask: (id: string) => void; onMoveTask: (task: Task, direction: -1 | 1) => Promise<void>; onCreate: (status?: Status) => void }) {
  return <section className="board" aria-label="任务看板">{statusOrder.map((status) => <StatusColumn key={status} status={status} tasks={tasks.filter((task) => task.status === status)} onOpenTask={onOpenTask} onMoveTask={onMoveTask} onCreate={onCreate} />)}</section>;
}

function StatusColumn({ status, tasks, onOpenTask, onMoveTask, onCreate }: { status: Status; tasks: Task[]; onOpenTask: (id: string) => void; onMoveTask: (task: Task, direction: -1 | 1) => Promise<void>; onCreate: (status?: Status) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `column:${status}`, data: { status } });
  return <section ref={setNodeRef} className={`board-column ${isOver ? 'drop-target' : ''}`} aria-label={statusLabels[status]}><header className="column-header"><div className="column-title"><StatusDot status={status} /><span>{statusLabels[status]}</span><span className="column-count">{tasks.length}</span></div><button className="icon-button tiny" title={`在${statusLabels[status]}中新建`} aria-label={`在${statusLabels[status]}中新建`} onClick={() => onCreate(status)}><MoreHorizontal size={15} /></button></header><div className="column-tasks">{tasks.length === 0 ? <div className="column-empty">拖动任务到这里</div> : tasks.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((task) => <TaskCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} onMove={(direction) => onMoveTask(task, direction)} />)}</div><div className="column-footer"><button className="add-task-button" onClick={() => onCreate(status)}><Plus size={15} />添加任务</button></div></section>;
}

function TaskCard({ task, onOpen, onMove }: { task: Task; onOpen: () => void; onMove: (direction: -1 | 1) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { taskId: task.id, status: task.status } });
  return <article ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={`task-card ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners} onClick={onOpen} tabIndex={0} aria-label={`${task.identifier} ${task.title}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } else if (event.key === 'ArrowRight') { event.preventDefault(); void onMove(1); } else if (event.key === 'ArrowLeft') { event.preventDefault(); void onMove(-1); } }}><div className="task-card-top"><span className="task-id">{task.identifier}</span><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><button className="card-menu" aria-label="任务操作" onClick={(event) => event.stopPropagation()}><MoreHorizontal size={15} /></button></div><h3>{task.title}</h3>{task.description && <p className="task-excerpt">{task.description.replace(/[#*_`\n]/g, ' ').trim()}</p>}<div className="task-card-bottom">{task.labels.length > 0 && <span className="label-chip">{task.labels[0]}{task.labels.length > 1 && ` +${task.labels.length - 1}`}</span>}{task.dueDate && <span className="due-date">{formatDate(task.dueDate)}</span>}{task.assignee && <span className="assignee" title={task.assignee}>{initial(task.assignee)}</span>}{task.sessions.length > 0 && <span className="session-count"><Sparkles size={12} />{task.sessions.length}</span>}</div></article>;
}
