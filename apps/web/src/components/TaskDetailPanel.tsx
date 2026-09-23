import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Archive, Check, CheckCheck, Copy, FileText, MessageSquare, Paperclip, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { Activity, Comment, Relation, Session, Task, TaskDetail } from '../../../../packages/contracts/index.ts';
import { platforms, priorityLabels, statusLabels } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { activityReadKey, readActivityMarker, unreadActivityCount } from '../lib/activityRead';
import { activityLabel, formatDate, formatTime, initial } from '../lib/format';
import { ErrorMessage, Markdown, Modal, StatusDot } from './shared';
import { AgentRunPanel } from './AgentRunPanel';

export function TaskDetailPanel({ taskId, revision, allTasks, onClose, onEdit, onCopy, onRefresh }: { taskId: string; revision?: number; allTasks: Task[]; onClose: () => void; onEdit: (task: Task) => void; onCopy: (task: Task) => Promise<void>; onRefresh: () => Promise<unknown> }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [comment, setComment] = useState('');
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [relationTargetId, setRelationTargetId] = useState('');
  const [relationType, setRelationType] = useState<Relation['type']>('related');
  const [relationBusy, setRelationBusy] = useState(false);
  const [sessionPlatform, setSessionPlatform] = useState<Session['platform']>('codex');
  const [sessionId, setSessionId] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [relationTasks, setRelationTasks] = useState<Record<string, Task>>({});
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [activitiesCursor, setActivitiesCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<'comments' | 'activities' | null>(null);
  const [activityReadAt, setActivityReadAt] = useState<string | null>(null);

  async function loadDetail(taskKey: string) {
    const value = await api.detail(taskKey);
    const [commentsPage, activitiesPage] = await Promise.all([
      api.commentsPage(value.task, undefined, 30),
      api.activitiesPage(value.task, undefined, 30),
    ]);
    setCommentsCursor(commentsPage.nextCursor);
    setActivitiesCursor(activitiesPage.nextCursor);
    setDetail({ ...value, comments: commentsPage.items, activities: activitiesPage.items });
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void loadDetail(taskId).then(() => undefined).catch((value) => { if (alive) setError(value); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, taskId]);

  useEffect(() => {
    let marker: string | null = null;
    try { marker = readActivityMarker(localStorage.getItem(activityReadKey(taskId))); } catch { /* Keep the activity marker in memory when storage is unavailable. */ }
    setActivityReadAt(marker);
  }, [taskId]);

  useEffect(() => {
    if (!detail || detail.task.id !== taskId || !detail.activities.length || activityReadAt !== null) return;
    const latest = detail.activities.at(-1)?.createdAt;
    if (!latest) return;
    setActivityReadAt(latest);
    try { localStorage.setItem(activityReadKey(taskId), latest); } catch { /* Keep the baseline in memory when storage is unavailable. */ }
  }, [activityReadAt, detail?.activities, taskId]);

  useEffect(() => {
    let alive = true;
    const ids = (detail?.relations ?? []).flatMap((relation) => [relation.sourceId, relation.targetId]).filter((id) => id !== detail?.task.id && !allTasks.some((item) => item.id === id) && !relationTasks[id]);
    if (!ids.length) return;
    void Promise.all(ids.map(async (id) => { try { return [id, (await api.detail(id)).task] as const; } catch { return null; } })).then((items) => {
      if (!alive) return;
      setRelationTasks((current) => Object.fromEntries([...Object.entries(current), ...items.filter((item): item is readonly [string, Task] => item !== null)]));
    });
    return () => { alive = false; };
  }, [allTasks, detail?.relations, detail?.task.id, relationTasks]);

  async function reload(taskKey = detail?.task.id) {
    if (!taskKey) return;
    await loadDetail(taskKey);
    await onRefresh();
  }

  function markActivitiesRead() {
    const latest = detail?.activities.at(-1)?.createdAt;
    if (!latest) return;
    setActivityReadAt(latest);
    try { localStorage.setItem(activityReadKey(taskId), latest); } catch { /* Keep the marker in memory when storage is unavailable. */ }
  }

  async function loadMore(kind: 'comments' | 'activities') {
    if (!detail) return;
    const cursor = kind === 'comments' ? commentsCursor : activitiesCursor;
    if (!cursor) return;
    setLoadingMore(kind);
    try {
      if (kind === 'comments') {
        const page = await api.commentsPage(detail.task, cursor, 30);
        setCommentsCursor(page.nextCursor);
        setDetail((current) => current ? { ...current, comments: [...current.comments, ...page.items] } : current);
      } else {
        const page = await api.activitiesPage(detail.task, cursor, 30);
        setActivitiesCursor(page.nextCursor);
        setDetail((current) => current ? { ...current, activities: [...current.activities, ...page.items] } : current);
      }
    } catch (value) { setError(value); } finally { setLoadingMore(null); }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!detail || detail.task.archivedAt || !comment.trim()) return;
    setCommentBusy(true);
    try {
      const created = await api.addComment(detail.task, comment.trim());
      if (commentFile) {
        const attachment = await api.uploadAttachment(detail.task, commentFile, created.id);
        const link = commentFile.type.startsWith('image/') ? `![${commentFile.name}](${api.attachmentUrl(attachment)})` : `[${commentFile.name}](${api.attachmentUrl(attachment)})`;
        await api.updateComment(created, `${created.body}\n\n${link}`);
      }
      setComment(''); setCommentFile(null); await reload();
    } catch (value) { setError(value); } finally { setCommentBusy(false); }
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

  async function addSession(event: FormEvent) {
    event.preventDefault();
    if (!detail || detail.task.archivedAt || !sessionId.trim()) return;
    setSessionBusy(true);
    try { await api.addSession(detail.task, { platform: sessionPlatform, sessionId: sessionId.trim() }); setSessionId(''); await reload(); } catch (value) { setError(value); } finally { setSessionBusy(false); }
  }

  async function removeSession(session: Session) {
    if (!detail || !window.confirm('移除这个 Agent 会话关联？')) return;
    setSessionBusy(true);
    try { await api.removeSession(detail.task, session); await reload(); } catch (value) { setError(value); } finally { setSessionBusy(false); }
  }

  async function copyTask() {
    if (!task) return;
    setCopyBusy(true);
    try { await onCopy(task); } catch (value) { setError(value); } finally { setCopyBusy(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !detail) return;
    setUploadBusy(true);
    try { await api.uploadAttachment(detail.task, file); await reload(); } catch (value) { setError(value); } finally { setUploadBusy(false); event.target.value = ''; }
  }

  async function deleteAttachment(attachmentId: string) {
    const attachment = detail?.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    setAttachmentBusy(attachmentId);
    try { await api.deleteAttachment(attachment); await reload(); } catch (value) { setError(value); } finally { setAttachmentBusy(null); }
  }

  async function mutateTask(action: 'archive-task' | 'restore-task' | 'complete-task' | 'delete-task', operation: () => Promise<unknown>) {
    if (!detail) return;
    setError(null);
    try { await operation(); if (action === 'delete-task') { onClose(); return; } await reload(); } catch (value) { setError(value); }
  }

  const task = detail?.task;
  const unreadActivities = unreadActivityCount(detail?.activities.map((item) => item.createdAt) ?? [], activityReadAt);
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
            <button className="button secondary" onClick={() => void copyTask()} disabled={copyBusy}><Copy size={15} />{copyBusy ? '复制中…' : '复制'}</button>
            {!task.archivedAt && task.status !== 'done' && <button className="button secondary" onClick={() => void mutateTask('complete-task', () => api.completeTask(task))}><Check size={15} />完成</button>}
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
              {commentsCursor && <button type="button" className="button secondary load-more" onClick={() => void loadMore('comments')} disabled={loadingMore === 'comments'}>{loadingMore === 'comments' ? '加载中…' : '加载更多评论'}</button>}
              <form className="comment-form" onSubmit={(event) => void addComment(event)}>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={task.archivedAt ? '归档任务不能新增评论' : '写下更新或下一步…'} rows={3} disabled={!!task.archivedAt} />
                <div className="comment-actions"><span className="comment-attachment-control"><label className="icon-button tiny upload-button" title="附加评论文件" aria-label="附加评论文件"><Paperclip size={14} /><input type="file" onChange={(event) => setCommentFile(event.target.files?.[0] ?? null)} disabled={commentBusy || !!task.archivedAt} /></label>{commentFile ? <span title={commentFile.name}>{commentFile.name}</span> : '支持 Markdown'}</span><button className="button primary" disabled={commentBusy || !!task.archivedAt || !comment.trim()}><MessageSquare size={15} />{commentBusy ? '发送中…' : '发表评论'}</button></div>
              </form>
            </section>
          </div>
          <aside className="detail-aside">
            <section className="aside-section"><h3>任务信息</h3><DetailField label="状态"><span className="inline-status"><StatusDot status={task.status} />{statusLabels[task.status]}</span></DetailField><DetailField label="优先级"><span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span></DetailField><DetailField label="开始日期">{formatDate(task.startDate) || '未设置'}</DetailField><DetailField label="截止日期">{formatDate(task.dueDate) || '未设置'}</DetailField><DetailField label="重复">{formatRecurrence(task.recurrence)}</DetailField><DetailField label="标签">{task.labels.length ? <span className="detail-labels">{task.labels.map((label) => <span className="label-chip" key={label}>{label}</span>)}</span> : '未设置'}</DetailField></section>
            <section className="aside-section"><div className="section-heading"><h3>附件 <span>{detail.attachments.length}</span></h3><label className="icon-button tiny upload-button" title="上传附件" aria-label="上传附件"><Upload size={15} /><input type="file" onChange={(event) => void upload(event)} disabled={uploadBusy} /></label></div>{detail.attachments.length === 0 ? <p className="muted-copy">没有附件</p> : <div className="attachment-list">{detail.attachments.map((item) => <div className="attachment-row" key={item.id}><a href={api.attachmentUrl(item)} target="_blank" rel="noreferrer"><Paperclip size={14} /><span>{item.filename}</span><small>{Math.ceil(item.size / 1024)} KB</small></a><button className="icon-button tiny danger-button" title="删除附件" aria-label="删除附件" onClick={() => void deleteAttachment(item.id)} disabled={attachmentBusy === item.id}><Trash2 size={13} /></button></div>)}</div>}</section>
            <section className="aside-section"><div className="section-heading"><h3>Agent 会话 <span>{task.sessions.length}</span></h3></div><form className="session-form" onSubmit={(event) => void addSession(event)}><select aria-label="会话平台" value={sessionPlatform} onChange={(event) => setSessionPlatform(event.target.value as Session['platform'])} disabled={sessionBusy || !!task.archivedAt}>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select><input aria-label="会话 ID" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="粘贴会话 ID" disabled={sessionBusy || !!task.archivedAt} /><button className="icon-button tiny" title="关联会话" aria-label="关联会话" disabled={sessionBusy || !sessionId.trim() || !!task.archivedAt}><Plus size={15} /></button></form>{task.sessions.length === 0 ? <p className="muted-copy">没有关联会话</p> : <div className="session-list">{task.sessions.map((session) => <div className="session-row" key={session.id}><span className="session-platform">{session.platform}</span><span title={session.sessionId}>{session.sessionId}</span><button className="icon-button tiny danger-button" title="移除会话" aria-label="移除会话" onClick={() => void removeSession(session)} disabled={sessionBusy}><Trash2 size={13} /></button></div>)}</div>}</section>
            <AgentRunPanel task={task} attachments={detail.attachments} />
            <section className="aside-section">
              <div className="section-heading"><h3>关联任务 <span>{detail.relations.length}</span></h3></div>
              <form className="relation-form" onSubmit={(event) => void addRelation(event)}>
                <select aria-label="选择关联任务" value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)} disabled={relationBusy || relationCandidates.length === 0}><option value="">选择任务</option>{relationCandidates.map((item) => <option key={item.id} value={item.id}>{item.identifier} · {item.title}</option>)}</select>
                <select aria-label="关联类型" value={relationType} onChange={(event) => setRelationType(event.target.value as Relation['type'])} disabled={relationBusy}><option value="related">相关</option><option value="blocks">阻塞</option><option value="parent">父子</option></select>
                <button className="icon-button tiny" title="添加关联" aria-label="添加关联" disabled={relationBusy || !relationTargetId}><Plus size={15} /></button>
              </form>
              {detail.relations.length === 0 ? <p className="muted-copy">暂无关联</p> : detail.relations.map((relation) => { const isSource = relation.sourceId === task.id; const otherId = isSource ? relation.targetId : relation.sourceId; const other = allTasks.find((item) => item.id === otherId) ?? relationTasks[otherId]; const label = relation.type === 'parent' ? (isSource ? '子任务' : '父任务') : relation.type === 'blocks' ? (isSource ? '阻塞' : '被阻塞') : '相关'; return <div className="relation-row" key={relation.id}><span className={`relation-type ${relation.type}`}>{label}</span><span>{other?.identifier ?? '任务已移除'}</span><span className="relation-title">{other?.title}</span><button className="icon-button tiny danger-button" title="移除关联" aria-label="移除关联" onClick={() => void removeRelation(relation)} disabled={relationBusy}><Trash2 size={13} /></button></div>; })}
            </section>
            <section className="aside-section activity-section"><div className="section-heading"><h3>活动记录 {unreadActivities > 0 && <span className="activity-unread">{unreadActivities}</span>}</h3>{unreadActivities > 0 && <button type="button" className="icon-button tiny activity-read-button" title="标为已读" aria-label="标为已读" onClick={markActivitiesRead}><CheckCheck size={14} /></button>}</div>{detail.activities.slice(-8).reverse().map((item: Activity) => <div className={`activity-row ${activityReadAt && item.createdAt > activityReadAt ? 'unread' : ''}`} key={item.id}><span className="activity-dot" /><div><strong>{activityLabel(item.action)}</strong><span>{item.actor} · {formatTime(item.createdAt)}</span></div></div>)}{activitiesCursor && <button type="button" className="button secondary load-more" onClick={() => void loadMore('activities')} disabled={loadingMore === 'activities'}>{loadingMore === 'activities' ? '加载中…' : '加载更多活动'}</button>}</section>
          </aside>
        </div>
      </>}
    </div>
  </Modal>;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) { return <div className="detail-field"><span>{label}</span><strong>{children}</strong></div>; }
function formatRecurrence(value: Task['recurrence']): string { if (!value) return '不重复'; const units: Record<NonNullable<Task['recurrence']>['unit'], string> = { day: '天', week: '周', month: '月', year: '年' }; return `每 ${value.interval} ${units[value.unit]}`; }
