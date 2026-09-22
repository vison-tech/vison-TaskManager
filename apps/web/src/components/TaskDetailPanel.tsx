import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Archive, Check, FileText, MessageSquare, Paperclip, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { Comment, Relation, Task, TaskDetail } from '../../../../packages/contracts/index.ts';
import { priorityLabels, statusLabels } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { activityLabel, formatDate, formatTime, initial } from '../lib/format';
import { ErrorMessage, Markdown, Modal, StatusDot } from './shared';

export function TaskDetailPanel({ taskId, revision, allTasks, onClose, onEdit, onRefresh }: { taskId: string; revision?: number; allTasks: Task[]; onClose: () => void; onEdit: (task: Task) => void; onRefresh: () => Promise<unknown> }) {
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
