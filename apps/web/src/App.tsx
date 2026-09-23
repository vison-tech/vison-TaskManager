import { useEffect, useMemo, useState } from 'react';
import { DndContext, pointerWithin, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Archive, BarChart3, CalendarRange, CirclePlus, ChevronDown, Columns3, Filter, FolderKanban, Inbox, Languages, LayoutList, ListFilter, Moon, Plus, RotateCcw, Search, Settings2, Sparkles, Sun, Undo2, X } from 'lucide-react';
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
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { DashboardView, TimelineView } from './components/InsightsView';
import { TaskModal } from './components/TaskModal';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { PreferencesModal } from './components/PreferencesModal';
import { matchesSearch } from './lib/format';
import { statusLabelsEn, useLocale } from './lib/locale';
import { defaultProjectPreferences, readProjectPreferences, writeProjectPreferences, type CardDisplayPreferences, type ProjectView, projectPreferencesKey } from './lib/projectPreferences';

const statusOrder = statuses;
type UndoAction = { label: string; task: Task; patch: Partial<TaskPatch> };

function App() {
  const { locale, text, toggleLocale } = useLocale();
  const { params, update } = useUrlState();
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [view, setView] = useState<ProjectView>(() => ['list', 'dashboard', 'timeline'].includes(params.get('view') ?? '') ? params.get('view') as ProjectView : 'board');
  const [search, setSearch] = useState(() => params.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>(() => (params.get('status') as Status | null) ?? 'all');
  const [showArchived, setShowArchived] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [projectSettingsModal, setProjectSettingsModal] = useState(false);
  const [preferencesModal, setPreferencesModal] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('taskmanager-theme') === 'dark' ? 'dark' : 'light');
  const [taskModal, setTaskModal] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<Status>('todo');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [preferencesProjectId, setPreferencesProjectId] = useState<string | null>(null);
  const [cardDisplay, setCardDisplay] = useState<CardDisplayPreferences>(defaultProjectPreferences.cardDisplay);
  const [cardDisplayOpen, setCardDisplayOpen] = useState(false);
  const workspace = useWorkspace(showArchived);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('taskmanager-theme', theme); }, [theme]);

  useEffect(() => {
    if (!undoAction) return;
    const timer = window.setTimeout(() => setUndoAction(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoAction]);

  const projects = workspace.data?.projects ?? [];
  const tasks = workspace.data?.tasks ?? [];
  const projectId = params.get('project') ?? projects[0]?.id ?? null;
  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const selectedTaskId = params.get('task');

  useEffect(() => {
    if (!projectId || preferencesProjectId === projectId) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(projectPreferencesKey); } catch { /* Use defaults when browser storage is unavailable. */ }
    const saved = readProjectPreferences(raw, projectId);
    if (!params.has('view')) setView(saved.view);
    if (!params.has('search')) setSearch(saved.search);
    if (!params.has('status')) setStatusFilter(saved.status);
    setShowArchived(saved.showArchived);
    setCardDisplay(saved.cardDisplay);
    setCardDisplayOpen(false);
    setPreferencesProjectId(projectId);
  }, [params, preferencesProjectId, projectId]);

  useEffect(() => {
    if (!projectId || preferencesProjectId !== projectId) return;
    try {
      localStorage.setItem(projectPreferencesKey, writeProjectPreferences(localStorage.getItem(projectPreferencesKey), projectId, { view, status: statusFilter, showArchived, search, cardDisplay }));
    } catch { /* Keep project preferences in memory when storage is unavailable. */ }
  }, [cardDisplay, preferencesProjectId, projectId, search, showArchived, statusFilter, view]);

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
  function chooseProject(next: Project) { update({ project: next.id, task: null, view: null, search: null, status: null }); setActionError(null); }
  function changeView(next: ProjectView) { setView(next); update({ view: next === 'board' ? null : next, task: null }); }
  function openCreateTask(status: Status = 'todo') { setNewTaskStatus(status); setTaskModal(true); }

  async function refresh() { await workspace.refetch(); }
  async function runAction(label: string, action: () => Promise<unknown>, undo?: UndoAction): Promise<boolean> {
    setPending(label); setActionError(null); if (label !== 'undo') setUndoAction(null);
    try { await action(); await refresh(); if (undo) setUndoAction(undo); return true; } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); return false; } finally { setPending(null); }
  }

  async function undoLastAction() {
    const action = undoAction;
    if (!action) return;
    const success = await runAction('undo', async () => { const current = await api.detail(action.task.id); await api.updateTask(current.task, action.patch); });
    if (success) setUndoAction(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const dragged = visibleTasks.find((task) => task.id === taskId);
    if (!dragged || !event.over) return;
    const overData = event.over.data.current as { status?: Status; taskId?: string } | undefined;
    const targetStatus = overData?.status ?? visibleTasks.find((task) => task.id === overData?.taskId)?.status;
    if (!targetStatus) return;
    const targetId = overData?.taskId;
    if (targetStatus === dragged.status && targetId === dragged.id) return;
    const sameColumn = visibleTasks.filter((task) => task.status === targetStatus && task.id !== dragged.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const targetIndex = targetId ? Math.max(0, sameColumn.findIndex((task) => task.id === targetId)) : sameColumn.length;
    const previous = sameColumn[targetIndex - 1];
    const target = sameColumn[targetIndex];
    const sortOrder = target ? (previous ? (previous.sortOrder + target.sortOrder) / 2 : target.sortOrder - 1) : (previous?.sortOrder ?? -1) + 1;
    await runAction('drag', () => api.updateTask(dragged, { status: targetStatus, sortOrder }), { label: '任务已移动', task: dragged, patch: { status: dragged.status, sortOrder: dragged.sortOrder } });
  }

  async function moveTaskByKeyboard(task: Task, direction: -1 | 1) {
    const currentIndex = statusOrder.indexOf(task.status); const nextStatus = statusOrder[currentIndex + direction];
    if (!nextStatus) return;
    const nextTasks = tasks.filter((item) => item.projectId === task.projectId && item.status === nextStatus && !item.archivedAt);
    const nextSortOrder = nextTasks.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    await runAction('keyboard-move', () => api.updateTask(task, { status: nextStatus, sortOrder: nextSortOrder }), { label: '任务已移动', task, patch: { status: task.status, sortOrder: task.sortOrder } });
  }

  async function reorderTaskByKeyboard(task: Task, direction: -1 | 1) {
    const siblings = tasks.filter((item) => item.projectId === task.projectId && item.status === task.status && !item.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
    const index = siblings.findIndex((item) => item.id === task.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    const neighbor = siblings[targetIndex + direction];
    const sortOrder = neighbor ? (target.sortOrder + neighbor.sortOrder) / 2 : target.sortOrder + direction;
    await runAction('keyboard-reorder', () => api.updateTask(task, { sortOrder }), { label: '任务顺序已更新', task, patch: { sortOrder: task.sortOrder } });
  }

  async function createTask(input: TaskInput) {
    await runAction('create-task', async () => { const created = await api.createTask(input); update({ task: created.id }); setTaskModal(false); });
  }

  async function updateTask(task: Task, input: Partial<TaskPatch>): Promise<boolean> {
    return runAction('update-task', async () => { const updated = await api.updateTask(task, input); setEditingTask(null); update({ task: updated.id }); });
  }

  async function updateTimelineTask(task: Task, input: Partial<TaskPatch>): Promise<boolean> {
    return runAction('timeline-update', () => api.updateTask(task, input));
  }

  async function copyTask(task: Task) {
    await runAction('copy-task', async () => {
      const copy = await api.copyTask(task, `${task.title}（副本）`);
      update({ task: copy.id });
    });
  }

  async function archiveTask(task: Task) {
    await runAction('archive-task', () => api.updateTask(task, { archivedAt: new Date().toISOString() }));
  }

  if (workspace.isLoading) return <div className="app-loading"><div className="loading-mark"><FolderKanban size={24} /></div><p>{text('正在加载工作区', 'Loading workspace')}</p><span>{text('连接本地任务服务…', 'Connecting to the local task service…')}</span></div>;
  if (workspace.error) return <div className="app-loading"><div className="loading-mark danger"><X size={24} /></div><h1>{text('任务服务暂时不可用', 'Task service unavailable')}</h1><ErrorMessage error={workspace.error} /><button className="button primary" onClick={() => void refresh()}><RotateCcw size={16} />{text('重试', 'Retry')}</button></div>;

  return <div className="app-shell">
    <Sidebar projects={projects} activeProject={project} revision={workspace.data?.revision} onSelect={chooseProject} onCreate={() => setProjectModal(true)} onPreferences={() => setPreferencesModal(true)} />
    <main className="main-area">
      <header className="topbar">
        <div className="crumb"><span className="crumb-mark"><Sparkles size={14} /></span><span>{text('任务工作台', 'Task workspace')}</span><ChevronDown size={14} /></div>
        <div className="topbar-actions"><span className="sync-status"><span className="sync-dot" />{text('本地已同步', 'Synced locally')}</span><button className="icon-button" title={locale === 'en' ? text('切换中文', 'Switch to Chinese') : text('切换英文', 'Switch to English')} aria-label={locale === 'en' ? text('切换中文', 'Switch to Chinese') : text('切换英文', 'Switch to English')} onClick={toggleLocale}><Languages size={17} /><span className="language-code">{locale === 'en' ? '中' : 'EN'}</span></button><button className="icon-button" title={theme === 'dark' ? text('切换浅色主题', 'Use light theme') : text('切换深色主题', 'Use dark theme')} aria-label={theme === 'dark' ? text('切换浅色主题', 'Use light theme') : text('切换深色主题', 'Use dark theme')} onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}><span className="theme-icon">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</span></button><button className="icon-button" title={text('项目设置', 'Project settings')} aria-label={text('项目设置', 'Project settings')} onClick={() => setProjectSettingsModal(true)} disabled={!project}><Settings2 size={17} /></button><div className="user-avatar">V</div></div>
      </header>
      <section className="workspace-header">
        <div className="title-row"><div><div className="eyebrow">{project?.prefix ?? 'WORKSPACE'} · {text('项目空间', 'Project')}</div><h1>{project?.name ?? text('选择一个项目', 'Select a project')}</h1></div><div className="header-actions"><button className="button secondary" onClick={() => openCreateTask()} disabled={!project}><Plus size={16} />{text('新建任务', 'New task')}</button><button className="button primary" onClick={() => openCreateTask()} disabled={!project}><CirclePlus size={16} />{text('创建', 'Create')}</button></div></div>
        <div className="workspace-meta"><span>{project?.taskCount ?? 0} {text('个活跃任务', 'active tasks')}</span><span className="meta-separator">/</span><span>{project?.workspacePath || text('未绑定工作区', 'No workspace linked')}</span>{project?.workspacePath && <span className="workspace-badge">Workspace</span>}</div>
      </section>
      <section className="toolbar" aria-label="任务筛选">
        <label className="search-box" htmlFor="task-search"><Search size={16} /><input id="task-search" value={search} onChange={(event) => setSearchValue(event.target.value)} placeholder={text('搜索任务、描述或标签', 'Search tasks, descriptions or labels')} /><kbd>/</kbd></label>
        <div className="toolbar-group"><label className="select-box"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusValue(event.target.value as Status | 'all')}><option value="all">{text('所有状态', 'All statuses')}</option>{statusOrder.map((status) => <option key={status} value={status}>{locale === 'en' ? statusLabelsEn[status] : statusLabels[status]}</option>)}</select></label><button className={`toolbar-button ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived((value) => !value)}><Archive size={15} />{showArchived ? text('显示活跃', 'Show active') : text('包含归档', 'Include archived')}</button><div className="card-display-control"><button className={`toolbar-button ${cardDisplayOpen ? 'active' : ''}`} aria-expanded={cardDisplayOpen} aria-haspopup="dialog" aria-label={text('卡片显示', 'Card display')} title={text('卡片显示', 'Card display')} onClick={() => setCardDisplayOpen((value) => !value)}><Columns3 size={15} />{text('卡片显示', 'Card display')}</button>{cardDisplayOpen && <div className="card-display-menu" role="dialog" aria-label={text('卡片显示设置', 'Card display settings')}><strong>{text('显示信息', 'Show information')}</strong>{([['description', '描述', 'Description'], ['labels', '标签', 'Labels'], ['dueDate', '截止日期', 'Due date'], ['assignee', '负责人', 'Assignee'], ['sessions', '会话数', 'Sessions']] as const).map(([key, zh, en]) => <label key={key}><input type="checkbox" checked={cardDisplay[key]} onChange={() => setCardDisplay((current) => ({ ...current, [key]: !current[key] }))} />{text(zh, en)}</label>)}</div>}</div><div className="view-switch" role="group" aria-label={text('视图切换', 'View switcher')}><button className={view === 'board' ? 'active' : ''} onClick={() => changeView('board')} aria-label={text('看板视图', 'Board view')} title={text('看板视图', 'Board view')}><LayoutList size={16} /></button><button className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')} aria-label={text('列表视图', 'List view')} title={text('列表视图', 'List view')}><ListFilter size={16} /></button><button className={view === 'dashboard' ? 'active' : ''} onClick={() => changeView('dashboard')} aria-label={text('仪表盘视图', 'Dashboard view')} title={text('仪表盘视图', 'Dashboard view')}><BarChart3 size={16} /></button><button className={view === 'timeline' ? 'active' : ''} onClick={() => changeView('timeline')} aria-label={text('时间轴视图', 'Timeline view')} title={text('时间轴视图', 'Timeline view')}><CalendarRange size={16} /></button></div></div>
      </section>
      {actionError && <div className="notice error" role="alert"><X size={15} /><span>{actionError}</span><button className="icon-button" onClick={() => setActionError(null)} aria-label={text('关闭错误提示', 'Close error')}><X size={14} /></button></div>}
      {undoAction && <div className="undo-toast" role="status"><span>{undoAction.label}</span><button className="button secondary" onClick={() => void undoLastAction()} disabled={pending === 'undo'}><Undo2 size={14} />{text('撤销', 'Undo')}</button><button className="icon-button tiny" onClick={() => setUndoAction(null)} aria-label={text('关闭撤销提示', 'Close undo notice')}><X size={14} /></button></div>}
      {!project ? <EmptyProject onCreate={() => setProjectModal(true)} /> : view === 'dashboard' ? <DashboardView key={project.id} tasks={visibleTasks} relations={workspace.data?.relations ?? []} projectId={project.id} /> : view === 'timeline' ? <TimelineView tasks={visibleTasks} relations={workspace.data?.relations ?? []} onUpdate={updateTimelineTask} /> : visibleTasks.length === 0 && !search && statusFilter === 'all' && !showArchived ? <EmptyBoard onCreate={() => openCreateTask()} /> : view === 'board' ? <DndContext sensors={dragSensors} collisionDetection={(args) => { const hits = pointerWithin(args); const cards = hits.filter((hit) => hit.data?.droppableContainer.data.current?.taskId); return cards.length ? cards : hits; }} onDragEnd={(event) => void handleDragEnd(event)}><Board tasks={visibleTasks} display={cardDisplay} onOpenTask={(id) => update({ task: id })} onMoveTask={moveTaskByKeyboard} onReorderTask={reorderTaskByKeyboard} onCreate={openCreateTask} /></DndContext> : <TaskList tasks={visibleTasks} onOpenTask={(id) => update({ task: id })} onUpdate={updateTask} />}
      {view !== 'dashboard' && view !== 'timeline' && visibleTasks.length === 0 && (search || statusFilter !== 'all' || showArchived) && <div className="no-results"><Inbox size={24} /><strong>{text('没有匹配的任务', 'No matching tasks')}</strong><span>{text('试试调整搜索词或筛选条件。', 'Try changing your search or filters.')}</span></div>}
    </main>
    {projectModal && <ProjectModal onClose={() => setProjectModal(false)} onCreated={async (input) => { await runAction('create-project', async () => { const created = await api.createProject(input); setProjectModal(false); await refresh(); update({ project: created.id, task: null }); }); }} />}
    {projectSettingsModal && project && <ProjectSettingsModal project={project} onClose={() => setProjectSettingsModal(false)} onSave={async ({ version, ...input }) => { const saved = await api.updateProjectAtVersion(project, input, version); setProjectSettingsModal(false); await refresh(); update({ project: saved.id }); }} onDelete={async () => { await api.deleteProject(project); setProjectSettingsModal(false); await refresh(); update({ project: null, task: null }); }} />}
    {preferencesModal && <PreferencesModal locale={locale} theme={theme} onLocaleToggle={toggleLocale} onThemeChange={setTheme} onClose={() => setPreferencesModal(false)} />}
    {taskModal && project && <TaskModal project={project} initialStatus={newTaskStatus} onClose={() => setTaskModal(false)} onSubmit={(input) => void createTask(input as TaskInput)} pending={pending === 'create-task'} />}
    {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} revision={workspace.data?.revision} allTasks={tasks} onClose={() => update({ task: null })} onEdit={(task) => setEditingTask(task)} onCopy={copyTask} onRefresh={refresh} />}
    {editingTask && <TaskModal task={editingTask} project={projects.find((item) => item.id === editingTask.projectId) ?? project!} onClose={() => setEditingTask(null)} onSubmit={(input) => void updateTask(editingTask, input as Partial<TaskPatch>)} pending={pending === 'update-task'} />}
  </div>;
}
export { App };
