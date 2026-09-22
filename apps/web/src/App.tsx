import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCorners, type DragEndEvent } from '@dnd-kit/core';
import { Archive, CirclePlus, ChevronDown, Filter, FolderKanban, Inbox, LayoutList, ListFilter, Plus, RotateCcw, Search, Settings2, Sparkles, X } from 'lucide-react';
import type { Project, Status, Task, TaskInput, TaskPatch } from '../../../packages/contracts/index.ts';
import { statuses, statusLabels } from '../../../packages/contracts/index.ts';
import { api } from './api';
import { useUrlState, useWorkspace } from './hooks';
import { ErrorMessage } from './components/shared';
import { Sidebar } from './components/WorkspaceSidebar';
import { Board } from './components/TaskBoard';
import { TaskList } from './components/TaskList';
import { EmptyBoard, EmptyProject } from './components/EmptyStates';
import { ProjectModal } from './components/ProjectModal';
import { TaskModal } from './components/TaskModal';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { matchesSearch } from './lib/format';

const statusOrder = statuses;

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
export { App };
