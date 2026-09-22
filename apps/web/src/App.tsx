import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { DndContext, closestCorners, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArrowLeft, Check, ChevronDown, CirclePlus, Clipboard, FileText, Filter, FolderKanban, GripVertical, Inbox, LayoutList, ListFilter, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plus, RotateCcw, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Comment, Project, Relation, Status, Task, TaskDetail, TaskInput, TaskPatch } from '../../../packages/contracts/index.ts';
import { priorities, priorityLabels, statuses, statusLabels } from '../../../packages/contracts/index.ts';
import { api } from './api';
import { useUrlState, useWorkspace } from './hooks';
import { ErrorMessage, Markdown, Modal, priorityNames, StatusDot, statusNames } from './components/shared';

const statusOrder = statuses;
const statusTone: Record<Status, string> = {
  backlog: 'slate', todo: 'blue', in_progress: 'amber', in_review: 'violet', blocked: 'red', done: 'green', canceled: 'muted',
};

function formatDate(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function initial(value: string) { return value.trim().slice(0, 1).toUpperCase() || '?'; }

function App() {
  const { params, update } = useUrlState();
  const [view, setView] = useState<'board' | 'list'>(() => params.get('view') === 'list' ? 'list' : 'board');
  const [search, setSearch] = useState(() => params.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>(() => (params.get('status') as Status | null) ?? 'all');
  const [showArchived, setShowArchived] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<Status>('todo');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const workspace = useWorkspace(showArchived);

  const projects = workspace.data?.projects ?? [];
  const tasks = workspace.data?.tasks ?? [];
  const projectId = params.get('project') ?? projects[0]?.id ?? null;
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const selectedTaskId = params.get('task');

  useEffect(() => {
    if (projects.length > 0 && !projects.some((item) => item.id === projectId)) update({ project: projects[0].id, task: null });
  }, [projectId, projects, update]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && event.target instanceof HTMLElement && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        event.preventDefault(); document.getElementById('task-search')?.focus();
      }
      if (event.key === 'Escape' && selectedTaskId && !document.querySelector('dialog[open]')) update({ task: null });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTaskId, update]);

  const visibleTasks = useMemo(() => tasks.filter((task) => task.projectId === project?.id && (showArchived || !task.archivedAt) && (statusFilter === 'all' || task.status === statusFilter) && matchesSearch(task, search)), [project?.id, search, showArchived, statusFilter, tasks]);

  function setSearchValue(value: string) { setSearch(value); update({ search: value || null }); }
  function setStatusValue(value: Status | 'all') { setStatusFilter(value); update({ status: value === 'all' ? null : value }); }
  function chooseProject(next: Project) { update({ project: next.id, task: null }); setActionError(null); }
  function changeView(next: 'board' | 'list') { setView(next); update({ view: next === 'board' ? null : next }); }
  function openCreateTask(status: Status = 'todo') { setNewTaskStatus(status); setTaskModal(true); }

  async function refresh() { await workspace.refetch(); }
  async function runAction(label: string, action: () => Promise<unknown>) {
    setPending(label); setActionError(null);
    try { await action(); await refresh(); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } finally { setPending(null); }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const dragged = visibleTasks.find((task) => task.id === taskId);
    if (!dragged || !event.over) return;
    const overData = event.over.data.current as { status?: Status; taskId?: string } | undefined;
    const targetStatus = overData?.status ?? visibleTasks.find((task) => task.id === overData?.taskId)?.status;
    if (!targetStatus) return;
    const targetId = overData?.taskId;
    if (targetStatus === dragged.status && (!targetId || targetId === dragged.id)) return;
    const sameColumn = visibleTasks.filter((task) => task.status === targetStatus && task.id !== dragged.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const targetIndex = targetId ? Math.max(0, sameColumn.findIndex((task) => task.id === targetId)) : sameColumn.length;
    const previous = sameColumn[targetIndex - 1];
    const target = sameColumn[targetIndex];
    const sortOrder = target ? (previous ? (previous.sortOrder + target.sortOrder) / 2 : target.sortOrder - 1) : (previous?.sortOrder ?? -1) + 1;
    await runAction('drag', () => api.updateTask(dragged, { status: targetStatus, sortOrder }));
  }

  async function moveTaskByKeyboard(task: Task, direction: -1 | 1) {
    const currentIndex = statusOrder.indexOf(task.status); const nextStatus = statusOrder[currentIndex + direction];
    if (!nextStatus) return;
    const nextTasks = tasks.filter((item) => item.projectId === task.projectId && item.status === nextStatus && !item.archivedAt);
    const nextSortOrder = nextTasks.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    await runAction('keyboard-move', () => api.updateTask(task, { status: nextStatus, sortOrder: nextSortOrder }));
  }

  async function createTask(input: TaskInput) {
    await runAction('create-task', async () => { const created = await api.createTask(input); update({ task: created.id }); setTaskModal(false); });
  }

  async function updateTask(task: Task, input: Partial<TaskPatch>) {
    await runAction('update-task', async () => { const updated = await api.updateTask(task, input); setEditingTask(null); update({ task: updated.id }); });
  }

  async function archiveTask(task: Task) {
    await runAction('archive-task', () => api.updateTask(task, { archivedAt: new Date().toISOString() }));
  }

  if (workspace.isLoading) return <div className="app-loading"><div className="loading-mark"><FolderKanban size={24} /></div><p>正在加载工作区</p><span>连接本地任务服务…</span></div>;
  if (workspace.error) return <div className="app-loading"><div className="loading-mark danger"><X size={24} /></div><h1>任务服务暂时不可用</h1><ErrorMessage error={workspace.error} /><button className="button primary" onClick={() => void refresh()}><RotateCcw size={16} />重试</button></div>;

  return <div className="app-shell">
    <Sidebar projects={projects} activeProject={project} onSelect={chooseProject} onCreate={() => setProjectModal(true)} />
    <main className="main-area">
      <header className="topbar">
        <div className="crumb"><span className="crumb-mark"><Sparkles size={14} /></span><span>任务工作台</span><ChevronDown size={14} /></div>
        <div className="topbar-actions"><span className="sync-status"><span className="sync-dot" />本地已同步</span><button className="icon-button" title="工作区设置" aria-label="工作区设置"><Settings2 size={17} /></button><div className="user-avatar">V</div></div>
      </header>
      <section className="workspace-header">
        <div className="title-row"><div><div className="eyebrow">{project?.prefix ?? 'WORKSPACE'} · 项目空间</div><h1>{project?.name ?? '选择一个项目'}</h1></div><div className="header-actions"><button className="button secondary" onClick={() => openCreateTask()} disabled={!project}><Plus size={16} />新建任务</button><button className="button primary" onClick={() => openCreateTask()} disabled={!project}><CirclePlus size={16} />创建</button></div></div>
        <div className="workspace-meta"><span>{project?.taskCount ?? 0} 个活跃任务</span><span className="meta-separator">/</span><span>{project?.workspacePath || '未绑定工作区'}</span>{project?.workspacePath && <span className="workspace-badge">Workspace</span>}</div>
      </section>
      <section className="toolbar" aria-label="任务筛选">
        <label className="search-box" htmlFor="task-search"><Search size={16} /><input id="task-search" value={search} onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索任务、描述或标签" /><kbd>/</kbd></label>
        <div className="toolbar-group"><label className="select-box"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusValue(event.target.value as Status | 'all')}><option value="all">所有状态</option>{statusOrder.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><button className={`toolbar-button ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived((value) => !value)}><Archive size={15} />{showArchived ? '显示活跃' : '包含归档'}</button><div className="view-switch" role="group" aria-label="视图切换"><button className={view === 'board' ? 'active' : ''} onClick={() => changeView('board')} aria-label="看板视图" title="看板视图"><LayoutList size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} aria-label="列表视图" title="列表视图"><ListFilter size={16} /></button></div></div>
      </section>
      {actionError && <div className="notice error" role="alert"><X size={15} /><span>{actionError}</span><button className="icon-button" onClick={() => setActionError(null)} aria-label="关闭错误提示"><X size={14} /></button></div>}
      {!project ? <EmptyProject onCreate={() => setProjectModal(true)} /> : visibleTasks.length === 0 && !search && statusFilter === 'all' && !showArchived ? <EmptyBoard onCreate={() => openCreateTask()} /> : view === 'board' ? <DndContext collisionDetection={closestCorners} onDragEnd={(event) => void handleDragEnd(event)}><Board tasks={visibleTasks} onOpenTask={(id) => update({ task: id })} onMoveTask={moveTaskByKeyboard} onCreate={openCreateTask} /></DndContext> : <TaskList tasks={visibleTasks} onOpenTask={(id) => update({ task: id })} />}
      {visibleTasks.length === 0 && (search || statusFilter !== 'all' || showArchived) && <div className="no-results"><Inbox size={24} /><strong>没有匹配的任务</strong><span>试试调整搜索词或筛选条件。</span></div>}
    </main>
    {projectModal && <ProjectModal onClose={() => setProjectModal(false)} onCreated={async (input) => { await runAction('create-project', async () => { const created = await api.createProject(input); setProjectModal(false); await refresh(); update({ project: created.id, task: null }); }); }} />}
    {taskModal && project && <TaskModal project={project} initialStatus={newTaskStatus} onClose={() => setTaskModal(false)} onSubmit={(input) => void createTask(input as TaskInput)} pending={pending === 'create-task'} />}
    {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} revision={workspace.data?.revision} allTasks={tasks} onClose={() => update({ task: null })} onEdit={(task) => setEditingTask(task)} onRefresh={refresh} />}
    {editingTask && <TaskModal task={editingTask} project={projects.find((item) => item.id === editingTask.projectId) ?? project!} onClose={() => setEditingTask(null)} onSubmit={(input) => void updateTask(editingTask, input as Partial<TaskPatch>)} pending={pending === 'update-task'} />}
  </div>;
}

function matchesSearch(task: Task, value: string) { const needle = value.trim().toLowerCase(); return !needle || [task.identifier, task.title, task.description, task.assignee, ...task.labels].join(' ').toLowerCase().includes(needle); }

function Sidebar({ projects, activeProject, onSelect, onCreate }: { projects: Project[]; activeProject: Project | null; onSelect: (project: Project) => void; onCreate: () => void }) {
  return <aside className="sidebar"><div className="brand"><div className="brand-icon"><FolderKanban size={18} /></div><span>TaskManager</span><span className="brand-version">LOCAL</span></div><div className="sidebar-section"><div className="section-label"><span>项目</span><button className="icon-button tiny" aria-label="新建项目" title="新建项目" onClick={onCreate}><Plus size={15} /></button></div><nav className="project-nav">{projects.map((project) => <button key={project.id} className={`project-link ${activeProject?.id === project.id ? 'active' : ''}`} onClick={() => onSelect(project)}><span className="project-glyph">{initial(project.name)}</span><span className="project-name">{project.name}</span><span className="project-count">{project.taskCount}</span></button>)}{projects.length === 0 && <div className="sidebar-empty">还没有项目</div>}</nav><button className="new-project-link" onClick={onCreate}><Plus size={15} />新建项目</button></div><div className="sidebar-bottom"><button className="sidebar-link"><Inbox size={16} />收件箱<span className="sidebar-link-count">0</span></button><button className="sidebar-link"><SlidersHorizontal size={16} />偏好设置</button><div className="connection-card"><span className="connection-light" /><div><strong>本地模式</strong><span>数据保存在本机</span></div><MoreHorizontal size={15} /></div></div></aside>;
}

function Board({ tasks, onOpenTask, onMoveTask, onCreate }: { tasks: Task[]; onOpenTask: (id: string) => void; onMoveTask: (task: Task, direction: -1 | 1) => Promise<void>; onCreate: (status?: Status) => void }) {
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

function TaskList({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (id: string) => void }) {
  return <section className="task-list"><div className="list-head"><span>任务</span><span>状态</span><span>优先级</span><span>截止日期</span><span>负责人</span></div>{tasks.length === 0 ? <div className="list-empty">列表为空</div> : statuses.flatMap((status) => tasks.filter((task) => task.status === status).sort((a, b) => a.sortOrder - b.sortOrder)).map((task) => <button className="list-row" key={task.id} onClick={() => onOpenTask(task.id)}><span className="list-title"><span className="task-id">{task.identifier}</span><strong>{task.title}</strong></span><span className="list-status"><StatusDot status={task.status} />{statusLabels[task.status]}</span><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span>{formatDate(task.dueDate) || '—'}</span><span>{task.assignee || '未分配'}</span></button>)}</section>;
}

function EmptyProject({ onCreate }: { onCreate: () => void }) { return <div className="empty-state"><div className="empty-icon"><FolderKanban size={24} /></div><h2>创建你的第一个项目</h2><p>项目用于隔离任务、工作区和 Agent 会话。</p><button className="button primary" onClick={onCreate}><Plus size={16} />新建项目</button></div>; }
function EmptyBoard({ onCreate }: { onCreate: () => void }) { return <div className="empty-state"><div className="empty-icon warm"><Sparkles size={24} /></div><h2>这个项目还没有任务</h2><p>从一个小任务开始，把进度集中在同一个地方。</p><button className="button primary" onClick={onCreate}><Plus size={16} />创建第一个任务</button></div>; }

function ProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (input: { name: string; prefix?: string; workspacePath?: string | null }) => Promise<void> }) {
  const [name, setName] = useState(''); const [prefix, setPrefix] = useState(''); const [workspacePath, setWorkspacePath] = useState(''); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (!name.trim()) { setError('请输入项目名称'); return; } setSaving(true); try { await onCreated({ name: name.trim(), prefix: prefix.trim() || undefined, workspacePath: workspacePath.trim() || null }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } }
  return <Modal title="新建项目" onClose={onClose}><form className="form-stack" onSubmit={(event) => void submit(event)}><label>项目名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：TaskManager" /></label><label>编号前缀<span className="field-hint">可选，最多 12 个字符</span><input value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} placeholder="例如：TM" maxLength={12} /></label><label>工作区路径<span className="field-hint">可选，用于关联本地代码目录</span><input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="/Users/you/project" /></label><ErrorMessage error={error} /><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? '创建中…' : '创建项目'}</button></div></form></Modal>;
}

function TaskModal({ project, task, initialStatus = 'todo', onClose, onSubmit, pending }: { project: Project; task?: Task; initialStatus?: Status; onClose: () => void; onSubmit: (input: TaskInput | Partial<TaskPatch>) => void; pending: boolean }) {
  const [title, setTitle] = useState(task?.title ?? ''); const [description, setDescription] = useState(task?.description ?? ''); const [status, setStatus] = useState<Status>(task?.status ?? initialStatus); const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'none'); const [assignee, setAssignee] = useState(task?.assignee ?? ''); const [startDate, setStartDate] = useState(task?.startDate ?? ''); const [dueDate, setDueDate] = useState(task?.dueDate ?? ''); const [labels, setLabels] = useState(task?.labels.join(', ') ?? ''); const [error, setError] = useState<string | null>(null);
  function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) { setError('请输入任务标题'); return; } if (startDate && dueDate && startDate > dueDate) { setError('开始日期不能晚于截止日期'); return; } const base = { title: title.trim(), description, status, priority, assignee, startDate: startDate || null, dueDate: dueDate || null, labels: labels.split(',').map((value) => value.trim()).filter(Boolean) }; if (task) onSubmit(base); else onSubmit({ ...base, projectId: project.id }); }
  return <Modal title={task ? `编辑 ${task.identifier}` : `在 ${project.name} 中新建任务`} onClose={onClose} wide><form className="task-form" onSubmit={submit}><div className="task-form-main"><label>标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="要完成什么？" /></label><label>描述<span className="field-hint">支持 Markdown</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="补充背景、验收标准或相关链接" rows={9} /></label></div><div className="task-form-side"><label>状态<select value={status} onChange={(event) => setStatus(event.target.value as Status)}>{statuses.map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}</select></label><label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value as Task['priority'])}>{priorities.map((item) => <option key={item} value={item}>{priorityLabels[item]}</option>)}</select></label><label>负责人<input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="用户名或 Agent" /></label><label>标签<span className="field-hint">使用逗号分隔</span><input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="frontend, mvp" /></label><div className="date-grid"><label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>截止日期<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div></div><ErrorMessage error={error} /><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={pending}>{pending ? '保存中…' : task ? '保存修改' : '创建任务'}</button></div></form></Modal>;
}

function TaskDetailPanel({ taskId, revision, allTasks, onClose, onEdit, onRefresh }: { taskId: string; revision?: number; allTasks: Task[]; onClose: () => void; onEdit: (task: Task) => void; onRefresh: () => Promise<unknown> }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [comment, setComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [relationTargetId, setRelationTargetId] = useState('');
  const [relationType, setRelationType] = useState<Relation['type']>('related');
  const [relationBusy, setRelationBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void api.detail(taskId).then((value) => { if (alive) setDetail(value); }).catch((value) => { if (alive) setError(value); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, taskId]);

  async function reload(taskKey = detail?.task.id) {
    if (!taskKey) return;
    setDetail(await api.detail(taskKey));
    await onRefresh();
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!detail || detail.task.archivedAt || !comment.trim()) return;
    setCommentBusy(true);
    try { await api.addComment(detail.task, comment.trim()); setComment(''); await reload(); } catch (value) { setError(value); } finally { setCommentBusy(false); }
  }

  async function saveComment(event: FormEvent, item: Comment) {
    event.preventDefault();
    if (!editingCommentBody.trim()) return;
    setCommentBusy(true);
    try { await api.updateComment(item, editingCommentBody.trim()); setEditingCommentId(null); setEditingCommentBody(''); await reload(); } catch (value) { setError(value); } finally { setCommentBusy(false); }
  }

  async function deleteComment(item: Comment) {
    if (!window.confirm('删除这条评论？此操作无法撤销。')) return;
    setCommentBusy(true);
    try { await api.deleteComment(item); await reload(); } catch (value) { setError(value); } finally { setCommentBusy(false); }
  }

  async function addRelation(event: FormEvent) {
    event.preventDefault();
    if (!detail || !relationTargetId) return;
    setRelationBusy(true);
    try { await api.addRelation(detail.task, relationTargetId, relationType); setRelationTargetId(''); await reload(); } catch (value) { setError(value); } finally { setRelationBusy(false); }
  }

  async function removeRelation(relation: Relation) {
    if (!detail || !window.confirm('移除这条任务关联？')) return;
    setRelationBusy(true);
    try { await api.removeRelation(detail.task, relation); await reload(); } catch (value) { setError(value); } finally { setRelationBusy(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !detail) return;
    setUploadBusy(true);
    try { await api.uploadAttachment(detail.task, file); await reload(); } catch (value) { setError(value); } finally { setUploadBusy(false); event.target.value = ''; }
  }

  async function mutateTask(action: 'archive-task' | 'restore-task' | 'delete-task', operation: () => Promise<unknown>) {
    if (!detail) return;
    setError(null);
    try { await operation(); if (action === 'delete-task') { onClose(); return; } await reload(); } catch (value) { setError(value); }
  }

  const task = detail?.task;
  const relationCandidates = allTasks.filter((item) => item.projectId === task?.projectId && item.id !== task?.id && !item.archivedAt);

  return <Modal title={task ? task.identifier : '任务详情'} onClose={onClose} wide>
    <div className="detail-shell">
      {loading && <div className="detail-loading">正在加载任务详情…</div>}
      {error ? <ErrorMessage error={error} /> : null}
      {task && detail && <>
        <div className="detail-toolbar">
          <div className="detail-state"><StatusDot status={task.status} /><span>{statusLabels[task.status]}</span><span className="detail-separator">·</span><span>{priorityLabels[task.priority]}</span></div>
          <div className="detail-actions">
            <button className="button secondary" onClick={() => onEdit(task)}><FileText size={15} />编辑</button>
            {task.archivedAt ? <button className="button secondary" onClick={() => void mutateTask('restore-task', () => api.updateTask(task, { archivedAt: null }))}><RotateCcw size={15} />恢复</button> : <button className="button secondary" onClick={() => void mutateTask('archive-task', () => api.updateTask(task, { archivedAt: new Date().toISOString() }))}><Archive size={15} />归档</button>}
            {task.archivedAt && <button className="icon-button danger-button" title="永久删除" aria-label="永久删除" onClick={() => { if (window.confirm('永久删除这个任务？此操作无法撤销。')) void mutateTask('delete-task', () => api.deleteTask(task)); }}><Trash2 size={16} /></button>}
          </div>
        </div>
        <div className="detail-grid">
          <div className="detail-main">
            <div className="detail-heading"><span className="task-id">{task.identifier}</span><h2>{task.title}</h2><div className="detail-submeta"><span>创建于 {formatTime(task.createdAt)}</span><span>·</span><span>更新于 {formatTime(task.updatedAt)}</span>{task.assignee && <><span>·</span><span>负责人 {task.assignee}</span></>}</div></div>
            <section className="detail-section"><h3>描述</h3>{task.description ? <Markdown text={task.description} /> : <p className="muted-copy">还没有描述。编辑任务补充背景和验收标准。</p>}</section>
            <section className="detail-section">
              <div className="section-heading"><h3>评论 <span>{detail.comments.length}</span></h3></div>
              <div className="comment-list">
                {detail.comments.length === 0 ? <p className="muted-copy">还没有评论。</p> : detail.comments.map((item) => <article className="comment" key={item.id}>
                  <div className="comment-avatar">{initial(item.author)}</div>
                  <div className="comment-body">
                    <div className="comment-meta"><strong>{item.author}</strong><span>{formatTime(item.createdAt)}</span><span className="comment-controls"><button className="icon-button tiny" title="编辑评论" aria-label="编辑评论" onClick={() => { setEditingCommentId(item.id); setEditingCommentBody(item.body); }}><Pencil size={13} /></button><button className="icon-button tiny danger-button" title="删除评论" aria-label="删除评论" onClick={() => void deleteComment(item)}><Trash2 size={13} /></button></span></div>
                    {editingCommentId === item.id ? <form className="comment-edit-form" onSubmit={(event) => void saveComment(event, item)}><textarea value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} rows={3} autoFocus /><div className="comment-actions"><button type="button" className="button secondary" onClick={() => { setEditingCommentId(null); setEditingCommentBody(''); }}>取消</button><button className="button primary" disabled={commentBusy || !editingCommentBody.trim()}><Check size={15} />保存</button></div></form> : <Markdown text={item.body} />}
                  </div>
                </article>)}
              </div>
              <form className="comment-form" onSubmit={(event) => void addComment(event)}>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={task.archivedAt ? '归档任务不能新增评论' : '写下更新或下一步…'} rows={3} disabled={!!task.archivedAt} />
                <div className="comment-actions"><span>支持 Markdown</span><button className="button primary" disabled={commentBusy || !!task.archivedAt || !comment.trim()}><MessageSquare size={15} />{commentBusy ? '发送中…' : '发表评论'}</button></div>
              </form>
            </section>
          </div>
          <aside className="detail-aside">
            <section className="aside-section"><h3>任务信息</h3><DetailField label="状态"><span className="inline-status"><StatusDot status={task.status} />{statusLabels[task.status]}</span></DetailField><DetailField label="优先级"><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span></DetailField><DetailField label="开始日期">{formatDate(task.startDate) || '未设置'}</DetailField><DetailField label="截止日期">{formatDate(task.dueDate) || '未设置'}</DetailField><DetailField label="标签">{task.labels.length ? <span className="detail-labels">{task.labels.map((label) => <span className="label-chip" key={label}>{label}</span>)}</span> : '未设置'}</DetailField></section>
            <section className="aside-section"><div className="section-heading"><h3>附件 <span>{detail.attachments.length}</span></h3><label className="icon-button tiny upload-button" title="上传附件" aria-label="上传附件"><Upload size={15} /><input type="file" onChange={(event) => void upload(event)} disabled={uploadBusy} /></label></div>{detail.attachments.length === 0 ? <p className="muted-copy">没有附件</p> : <div className="attachment-list">{detail.attachments.map((item) => <a key={item.id} href={api.attachmentUrl(item)} target="_blank" rel="noreferrer"><Paperclip size={14} /><span>{item.filename}</span><small>{Math.ceil(item.size / 1024)} KB</small></a>)}</div>}</section>
            <section className="aside-section">
              <div className="section-heading"><h3>关联任务 <span>{detail.relations.length}</span></h3></div>
              <form className="relation-form" onSubmit={(event) => void addRelation(event)}>
                <select aria-label="选择关联任务" value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)} disabled={relationBusy || relationCandidates.length === 0}><option value="">选择任务</option>{relationCandidates.map((item) => <option key={item.id} value={item.id}>{item.identifier} · {item.title}</option>)}</select>
                <select aria-label="关联类型" value={relationType} onChange={(event) => setRelationType(event.target.value as Relation['type'])} disabled={relationBusy}><option value="related">相关</option><option value="blocks">阻塞</option><option value="parent">父子</option></select>
                <button className="icon-button tiny" title="添加关联" aria-label="添加关联" disabled={relationBusy || !relationTargetId}><Plus size={15} /></button>
              </form>
              {detail.relations.length === 0 ? <p className="muted-copy">暂无关联</p> : detail.relations.map((relation) => { const otherId = relation.sourceId === task.id ? relation.targetId : relation.sourceId; const other = allTasks.find((item) => item.id === otherId); return <div className="relation-row" key={relation.id}><span className={`relation-type ${relation.type}`}>{relation.type === 'parent' ? '父子' : relation.type === 'blocks' ? '阻塞' : '相关'}</span><span>{other?.identifier ?? '任务已移除'}</span><span className="relation-title">{other?.title}</span><button className="icon-button tiny danger-button" title="移除关联" aria-label="移除关联" onClick={() => void removeRelation(relation)} disabled={relationBusy}><Trash2 size={13} /></button></div>; })}
            </section>
            <section className="aside-section activity-section"><h3>活动记录</h3>{detail.activities.slice(-8).reverse().map((item) => <div className="activity-row" key={item.id}><span className="activity-dot" /><div><strong>{activityLabel(item.action)}</strong><span>{item.actor} · {formatTime(item.createdAt)}</span></div></div>)}</section>
          </aside>
        </div>
      </>}
    </div>
  </Modal>;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) { return <div className="detail-field"><span>{label}</span><strong>{children}</strong></div>; }
function activityLabel(action: string) { const labels: Record<string, string> = { 'task.created': '创建了任务', 'task.updated': '更新了任务', 'comment.created': '添加了评论', 'comment.updated': '编辑了评论', 'comment.deleted': '删除了评论', 'attachment.created': '上传了附件', 'attachment.deleted': '删除了附件', 'relation.created': '添加了任务关联', 'relation.deleted': '删除了任务关联', 'session.created': '关联了 Agent 会话', 'session.deleted': '移除了 Agent 会话' }; return labels[action] ?? action; }

export { App };
