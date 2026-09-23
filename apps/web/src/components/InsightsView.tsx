import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { CalendarRange, CheckCircle2, CircleAlert, Clock3, Star, Target, TrendingUp, Users } from 'lucide-react';
import type { Relation, Task, TaskPatch } from '../../../../packages/contracts/index.ts';
import { priorities, priorityLabels, statuses, statusLabels } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { formatDate } from '../lib/format';
import { StatusDot } from './shared';
import { priorityLabelsEn, statusLabelsEn, useLocale } from '../lib/locale';

type ViewProps = { tasks: Task[]; relations: Relation[]; onUpdate: (task: Task, input: Partial<TaskPatch>) => Promise<boolean> };

function dayValue(value: string) { return Date.parse(`${value}T00:00:00Z`); }
function todayValue() { return new Date().toISOString().slice(0, 10); }

export function DashboardView({ tasks, relations, projectId }: { tasks: Task[]; relations: Relation[]; projectId: string }) {
  const { locale, text } = useLocale();
  const focusKey = `taskmanager.focused-tasks:${projectId}`;
  const [focusedIds, setFocusedIds] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem(focusKey) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } });
  const active = tasks.filter((task) => !task.archivedAt);
  const completed = active.filter((task) => task.status === 'done').length;
  const overdue = active.filter((task) => task.dueDate && task.dueDate < todayValue() && !['done', 'canceled'].includes(task.status)).length;
  const noDate = active.filter((task) => !task.startDate && !task.dueDate).length;
  const completion = active.length ? Math.round((completed / active.length) * 100) : 0;
  const statusCounts = statuses.map((status) => ({ status, count: active.filter((task) => task.status === status).length }));
  const priorityCounts = priorities.map((priority) => ({ priority, count: active.filter((task) => task.priority === priority).length }));
  const recent = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const focused = active.filter((task) => focusedIds.includes(task.id));
  const today = dayValue(todayValue());
  const trend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today - (6 - index) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: active.filter((task) => task.updatedAt.slice(0, 10) === day).length };
  });
  const maxTrend = Math.max(...trend.map((item) => item.count), 1);
  const contributors = [...new Set(active.map((task) => task.assignee.trim() || '未分配'))]
    .map((name) => ({ name, count: active.filter((task) => (task.assignee.trim() || '未分配') === name).length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6);
  const activeIds = new Set(active.map((task) => task.id));
  const parentLinks = relations.filter((relation) => relation.type === 'parent' && activeIds.has(relation.sourceId) && activeIds.has(relation.targetId));
  const childDone = parentLinks.filter((relation) => active.find((task) => task.id === relation.targetId)?.status === 'done').length;

  function toggleFocus(taskId: string) {
    setFocusedIds((current) => { const next = current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]; try { localStorage.setItem(focusKey, JSON.stringify(next)); } catch { /* Focus is a local preference. */ } return next; });
  }

  return <section className="insights-page" aria-label={text('项目仪表盘', 'Project dashboard')}>
    <div className="insights-heading"><div><span className="eyebrow">{text('项目概览', 'Project overview')}</span><h2>{text('工作进展', 'Progress')}</h2></div><span className="insights-updated">{text('基于当前项目任务实时计算', 'Calculated from current project tasks')}</span></div>
    <div className="metric-grid">
      <Metric icon={<Target size={17} />} label={text('活跃任务', 'Active tasks')} value={active.length} detail={`${completed} ${text('个已完成', 'completed')}`} />
      <Metric icon={<CheckCircle2 size={17} />} label={text('完成度', 'Completion')} value={`${completion}%`} detail={active.length ? `${completed} / ${active.length}` : text('暂无任务', 'No tasks')} />
      <Metric icon={<CircleAlert size={17} />} label={text('已逾期', 'Overdue')} value={overdue} detail={text('未完成且超过截止日期', 'Incomplete past due date')} danger={overdue > 0} />
      <Metric icon={<Clock3 size={17} />} label={text('未排日期', 'Unscheduled')} value={noDate} detail={text('可在时间轴中补充', 'Add dates on the timeline')} />
    </div>
    <div className="insights-columns">
      <section className="insights-section"><div className="insights-section-head"><h3>{text('状态分布', 'Status distribution')}</h3><span>{active.length} {text('项', 'items')}</span></div><div className="status-bars">{statusCounts.map(({ status, count }) => <div className="status-bar-row" key={status}><div className="status-bar-label"><StatusDot status={status} /><span>{locale === 'en' ? statusLabelsEn[status] : statusLabels[status]}</span><strong>{count}</strong></div><div className="status-bar-track"><i style={{ width: `${active.length ? Math.max(count / active.length * 100, count ? 4 : 0) : 0}%` }} /></div></div>)}</div></section>
      <section className="insights-section"><div className="insights-section-head"><h3>{text('优先级', 'Priority')}</h3><span>{text('活跃任务', 'Active tasks')}</span></div><div className="priority-list">{priorityCounts.map(({ priority, count }) => <div className="priority-row" key={priority}><span className={`priority priority-${priority}`}>{locale === 'en' ? priorityLabelsEn[priority] : priorityLabels[priority]}</span><strong>{count}</strong><span className="priority-share">{active.length ? `${Math.round(count / active.length * 100)}%` : '0%'}</span></div>)}</div></section>
    </div>
    <div className="insights-columns insights-secondary">
      <section className="insights-section"><div className="insights-section-head"><h3><TrendingUp size={14} />最近 7 日更新</h3><span>按任务更新时间</span></div><div className="trend-chart" role="img" aria-label="最近 7 日任务更新趋势">{trend.map((item) => <div className="trend-day" key={item.day}><div className="trend-track"><i style={{ height: `${Math.max(item.count / maxTrend * 100, item.count ? 10 : 0)}%` }} title={`${item.day} ${item.count} 项`} /></div><strong>{item.count}</strong><span>{item.day.slice(5)}</span></div>)}</div></section>
      <section className="insights-section"><div className="insights-section-head"><h3><Users size={14} />负责人分布</h3><span>活跃任务</span></div>{contributors.length ? <div className="contributor-list">{contributors.map((item) => <div className="contributor-row" key={item.name}><span>{item.name}</span><i><b style={{ width: `${item.count / Math.max(contributors[0].count, 1) * 100}%` }} /></i><strong>{item.count}</strong></div>)}</div> : <p className="muted-copy">当前项目还没有任务。</p>}</section>
    </div>
    <section className="insights-section parent-progress"><div className="insights-section-head"><h3>父子完成度</h3><span>直接子任务</span></div><div className="parent-progress-value"><strong>{childDone} / {parentLinks.length}</strong><span>{parentLinks.length ? `${Math.round(childDone / parentLinks.length * 100)}% 的直接子任务已完成` : '当前项目没有父子关系'}</span></div><div className="status-bar-track"><i style={{ width: `${parentLinks.length ? childDone / parentLinks.length * 100 : 0}%` }} /></div></section>
    <section className="insights-section recent-section"><div className="insights-section-head"><h3>最近变更</h3><span>按更新时间</span></div>{recent.length ? <div className="recent-list">{recent.map((task) => <div className="recent-row" key={task.id}><StatusDot status={task.status} /><div><strong>{task.identifier} · {task.title}</strong><span>{statusLabels[task.status]} · {formatDate(task.updatedAt.slice(0, 10))}</span></div><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span><button className={`icon-button tiny focus-button ${focusedIds.includes(task.id) ? 'active' : ''}`} title={focusedIds.includes(task.id) ? '取消关注' : '关注任务'} aria-label={focusedIds.includes(task.id) ? '取消关注任务' : '关注任务'} onClick={() => toggleFocus(task.id)}><Star size={14} fill={focusedIds.includes(task.id) ? 'currentColor' : 'none'} /></button></div>)}</div> : <p className="muted-copy">当前项目还没有任务。</p>}</section>
    <section className="insights-section focus-section"><div className="insights-section-head"><h3>关注任务</h3><span>{focused.length} 项</span></div>{focused.length ? <div className="recent-list">{focused.map((task) => <div className="recent-row" key={task.id}><StatusDot status={task.status} /><div><strong>{task.identifier} · {task.title}</strong><span>{statusLabels[task.status]} · {formatDate(task.dueDate) || '未设置截止日期'}</span></div><button className="icon-button tiny focus-button active" title="取消关注" aria-label="取消关注任务" onClick={() => toggleFocus(task.id)}><Star size={14} fill="currentColor" /></button></div>)}</div> : <p className="muted-copy">在最近变更中点击星标，固定需要持续关注的任务。</p>}</section>
  </section>;
}

function Metric({ icon, label, value, detail, danger = false }: { icon: ReactNode; label: string; value: string | number; detail: string; danger?: boolean }) {
  return <div className={`metric ${danger ? 'danger' : ''}`}><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

type DependencyLine = { id: string; type: Relation['type']; path: string };

export function TimelineView({ tasks, relations, onUpdate }: ViewProps) {
  const { locale, text } = useLocale();
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('week');
  const [hideComplete, setHideComplete] = useState(false);
  const [dragState, setDragState] = useState<{ task: Task; startX: number; trackWidth: number; unitMs: number } | null>(null);
  const [dragDays, setDragDays] = useState(0);
  const [dependencyLines, setDependencyLines] = useState<DependencyLine[]>([]);
  const [dependencySize, setDependencySize] = useState({ width: 0, height: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dated = useMemo(() => tasks.filter((task) => task.startDate || task.dueDate).filter((task) => !hideComplete || !['done', 'canceled'].includes(task.status)), [hideComplete, tasks]);
  const bounds = useMemo(() => {
    const values = dated.flatMap((task) => [task.startDate, task.dueDate].filter((value): value is string => Boolean(value))).map(dayValue);
    const today = dayValue(todayValue());
    const start = values.length ? Math.min(...values, today) : today;
    const end = values.length ? Math.max(...values, today) : today;
    const unit = mode === 'day' ? 86_400_000 : mode === 'week' ? 604_800_000 : 2_629_800_000;
    const span = Math.max(unit * (mode === 'day' ? 14 : mode === 'week' ? 8 : 6), end - start + unit);
    return { start, end: start + span };
  }, [dated, mode]);
  const width = bounds.end - bounds.start;
  const unitMs = mode === 'day' ? 86_400_000 : mode === 'week' ? 604_800_000 : 2_629_800_000;
  const axisLabels = Array.from({ length: mode === 'day' ? 14 : mode === 'week' ? 8 : 6 }, (_, index) => new Date(bounds.start + index * unitMs).toISOString().slice(0, 10));

  useLayoutEffect(() => {
    const measure = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const gridBounds = grid.getBoundingClientRect();
      const width = Math.max(grid.clientWidth, grid.scrollWidth);
      const height = Math.max(grid.clientHeight, grid.scrollHeight);
      const visibleIds = new Set(dated.map((task) => task.id));
      const next = relations.filter((relation) => relation.type === 'parent' || relation.type === 'blocks').flatMap((relation) => {
        if (!visibleIds.has(relation.sourceId) || !visibleIds.has(relation.targetId)) return [];
        const source = barRefs.current[relation.sourceId]?.getBoundingClientRect();
        const target = barRefs.current[relation.targetId]?.getBoundingClientRect();
        if (!source || !target) return [];
        const startX = source.right - gridBounds.left;
        const startY = source.top + source.height / 2 - gridBounds.top;
        const endX = target.left - gridBounds.left;
        const endY = target.top + target.height / 2 - gridBounds.top;
        const bend = Math.max(18, Math.abs(endX - startX) / 2);
        return [{ id: relation.id, type: relation.type, path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}` }];
      });
      setDependencySize({ width, height });
      setDependencyLines(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [dated, mode, relations]);

  useEffect(() => {
    if (!dragState) return;
    const move = (event: globalThis.PointerEvent) => setDragDays(Math.round(((event.clientX - dragState.startX) / dragState.trackWidth * width) / 86_400_000));
    const up = () => {
      const task = dragState.task;
      const shift = dragDays * 86_400_000;
      const originalStart = dayValue(task.startDate ?? task.dueDate!);
      const originalEnd = dayValue(task.dueDate ?? task.startDate!);
      const nextStart = new Date(originalStart + shift).toISOString().slice(0, 10);
      const nextEnd = new Date(originalEnd + shift).toISOString().slice(0, 10);
      setDragState(null); setDragDays(0);
      if (dragDays !== 0) void updateLatest(task, { startDate: task.startDate ? nextStart : null, dueDate: task.dueDate ? nextEnd : null });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragDays, dragState, onUpdate, width]);

  async function updateLatest(task: Task, input: Partial<TaskPatch>) {
    const latest = await api.detail(task.id);
    await onUpdate(latest.task, input);
  }

  async function saveDate(task: Task, field: 'startDate' | 'dueDate', value: string) { await updateLatest(task, { [field]: value || null }); }

 return <section className="timeline-page" aria-label={text('项目时间轴', 'Project timeline')}>
    <div className="timeline-toolbar"><div><span className="eyebrow">{text('日期规划', 'Date planning')}</span><h2>{text('时间轴', 'Timeline')}</h2></div><div className="timeline-actions"><div className="timeline-modes" role="group" aria-label={text('时间轴范围', 'Timeline range')}>{(['day', 'week', 'month'] as const).map((value) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value === 'day' ? text('日', 'Day') : value === 'week' ? text('周', 'Week') : text('月', 'Month')}</button>)}</div><label className="timeline-toggle"><input type="checkbox" checked={hideComplete} onChange={(event) => setHideComplete(event.target.checked)} />{text('隐藏已完成', 'Hide completed')}</label><button className="button secondary" onClick={() => setMode('week')}><CalendarRange size={14} />{text('今天', 'Today')}</button></div></div>
    {dated.length === 0 ? <div className="timeline-empty"><CalendarRange size={24} /><strong>{text('没有可显示的日期', 'No dates to display')}</strong><span>{text('在任务详情或列表中添加开始日期或截止日期。', 'Add a start or due date in the task detail or list.')}</span></div> : <div className="timeline-grid" ref={gridRef}><svg className="timeline-dependencies" width={dependencySize.width} height={dependencySize.height} viewBox={`0 0 ${dependencySize.width} ${dependencySize.height}`} aria-hidden="true" style={{ pointerEvents: 'none' }}><defs><marker id="timeline-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="currentColor" /></marker></defs>{dependencyLines.map((line) => <path key={line.id} className={`dependency-line ${line.type}`} d={line.path} markerEnd="url(#timeline-arrow)" />)}</svg><div className="timeline-axis"><div className="timeline-label-spacer" />{axisLabels.map((label) => <span key={label}>{label}</span>)}</div>{dated.map((task) => { const start = dayValue(task.startDate ?? task.dueDate!); const end = dayValue(task.dueDate ?? task.startDate!); const isDragging = dragState?.task.id === task.id; const left = Math.max(0, (start - bounds.start) / width * 100) + (isDragging ? dragDays * 86_400_000 / width * 100 : 0); const barWidth = Math.max(2, ((Math.max(end, start) - start + 86_400_000) / width) * 100); return <div className="timeline-row" key={task.id}><div className="timeline-task"><strong>{task.identifier}</strong><span>{task.title}</span><div className="timeline-date-fields"><input aria-label={`${task.identifier} ${text('开始日期', 'Start date')}`} type="date" value={task.startDate ?? ''} onChange={(event) => void saveDate(task, 'startDate', event.target.value)} /><input aria-label={`${task.identifier} ${text('截止日期', 'Due date')}`} type="date" value={task.dueDate ?? ''} onChange={(event) => void saveDate(task, 'dueDate', event.target.value)} /></div></div><div className="timeline-track"><div ref={(element) => { barRefs.current[task.id] = element; }} className={`timeline-bar status-${task.status} ${isDragging ? 'dragging' : ''}`} style={{ left: `${left}%`, width: `${barWidth}%` }} title={`${task.identifier} ${task.title}`} onPointerDown={(event: PointerEvent<HTMLDivElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); setDragState({ task, startX: event.clientX, trackWidth: event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1, unitMs }); }}><span>{locale === 'en' ? statusLabelsEn[task.status] : statusLabels[task.status]}</span></div></div></div>; })}</div>}
  </section>;
}
