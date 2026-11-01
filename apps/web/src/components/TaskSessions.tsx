import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, ExternalLink, FileText, Link, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Session, SessionRef, Task } from '../../../../packages/contracts/index.ts';
import { platforms } from '../../../../packages/contracts/index.ts';
import type { EmbeddedHostClient } from '../../../../packages/contracts/embeddedHost.ts';
import { embeddedHost, useEmbeddedHost } from '../lib/embeddedHost';
import { currentHostSession, hasTaskSession, taskConversationDraft } from '../lib/hostContext';
import { useLocale } from '../lib/locale';
import { api } from '../api';
import { ErrorMessage } from './shared';

type SessionApi = Pick<typeof api, 'addSession' | 'removeSession'>;
export function TaskSessions({ task, onRefresh, host = embeddedHost, sessionApi = api }: { task: Task; onRefresh: () => Promise<unknown>; host?: EmbeddedHostClient | null; sessionApi?: SessionApi }) {
  const { text } = useLocale();
  const snapshot = useEmbeddedHost(host);
  const [platform, setPlatform] = useState<Session['platform']>('codex');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const mounted = useRef(false);
  const working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = currentHostSession(snapshot);
  const linked = hasTaskSession(task, current);
  const disabled = busy || !!task.archivedAt;

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null); setNotice('');
    try { await action(); } catch (value) { if (mounted.current) setError(value); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  async function link(session: SessionRef) {
    if (!mounted.current || task.archivedAt) return;
    if (hasTaskSession(task, session)) { setNotice(text('此会话已关联。', 'This conversation is already linked.')); return; }
    await sessionApi.addSession(task, session);
    if (mounted.current) { setSessionId(''); await onRefresh(); }
  }

  function addManual(event: FormEvent) {
    event.preventDefault();
    if (disabled || !sessionId.trim()) return;
    void run(() => link({ platform, sessionId: sessionId.trim() }));
  }

  async function linkCurrent() {
    if (!host || disabled) return;
    await run(async () => {
      const observed = currentHostSession(await host.refresh());
      if (!mounted.current) return;
      if (!observed) throw new Error(text('当前对话不可用，请打开 Codex 对话后刷新。', 'The current conversation is unavailable. Open a Codex conversation and refresh.'));
      await link(observed);
    });
  }

  async function compose() {
    if (!host || disabled) return;
    await run(async () => {
      const latest = await host.refresh();
      const observed = currentHostSession(latest);
      if (!mounted.current) return;
      if (!observed || !hasTaskSession(task, observed)) throw new Error(text('当前对话已变化，请先关联此对话。', 'The current conversation changed. Link it before preparing a draft.'));
      if (latest.capabilities.composeDraft.state !== 'supported') throw new Error(text('当前 Codex 暂不支持填入草稿。', 'Draft preparation is unavailable in this Codex window.'));
      await host.composeDraft({ sessionId: observed.sessionId, text: taskConversationDraft(task) });
      if (mounted.current) setNotice(text('草稿已填入，请在 Codex 中检查后自行发送。', 'Draft prepared. Review it in Codex before sending.'));
    });
  }

  async function remove(session: Session) {
    if (busy || !window.confirm(text('移除这个 Agent 会话关联？', 'Remove this Agent conversation link?'))) return;
    await run(async () => { await sessionApi.removeSession(task, session); if (mounted.current) await onRefresh(); });
  }

  async function copyDraft() {
    await run(async () => {
      if (!navigator.clipboard?.writeText) throw new Error(text('无法自动复制，请选中下方草稿手动复制。', 'Automatic copying is unavailable. Select the draft below and copy it manually.'));
      await navigator.clipboard.writeText(taskConversationDraft(task));
      if (mounted.current) setNotice(text('已复制任务草稿，请检查后自行发送。', 'Task draft copied. Review it before sending.'));
    });
  }

  const contextUnavailable = !current ? text('未识别到当前 Codex 对话，可手动关联。', 'No current Codex conversation was identified. You can link one manually.') : '';
  return <section className="aside-section task-sessions">
    <div className="section-heading"><h3>{text('Agent 会话', 'Agent conversations')} <span>{task.sessions.length}</span></h3></div>
    {host && <div className="host-session-controls">
      <div className="host-session-actions">
        <button type="button" className="button secondary" onClick={() => void linkCurrent()} disabled={disabled || !current || linked}><Link size={14} />{linked ? text('当前对话已关联', 'Current conversation linked') : text('关联当前 Codex 会话', 'Link current Codex conversation')}</button>
        <button type="button" className="icon-button tiny" aria-label={text('刷新当前会话', 'Refresh current conversation')} title={text('刷新当前会话', 'Refresh current conversation')} onClick={() => void run(async () => { await host.refresh(); })} disabled={busy}><RefreshCw size={14} /></button>
      </div>
      {contextUnavailable && <p className="muted-copy">{contextUnavailable}</p>}
      <button type="button" className="button secondary" aria-expanded={showDraft} onClick={() => setShowDraft((value) => !value)}><FileText size={14} />{text('查看任务草稿', 'View task draft')}</button>
      {showDraft && <div className="host-task-draft"><label>{text('任务草稿（未发送）', 'Task draft (not sent)')}<textarea aria-label={text('任务草稿（未发送）', 'Task draft (not sent)')} readOnly value={taskConversationDraft(task)} rows={7} /></label><button type="button" className="button secondary" onClick={() => void copyDraft()} disabled={busy}><Copy size={14} />{text('复制草稿', 'Copy draft')}</button></div>}
      {snapshot?.capabilities.composeDraft.state === 'supported' ? <button type="button" className="button secondary" onClick={() => void compose()} disabled={disabled || !linked}><Pencil size={14} />{text('填入当前对话草稿', 'Prepare a draft in this conversation')}</button> : <p className="muted-copy">{text('当前宿主暂不支持安全填入草稿；可手动复制任务内容。', 'This host cannot safely prepare a draft yet. You can copy the task text manually.')}</p>}
    </div>}
    <form className="session-form" onSubmit={addManual}>
      <select aria-label={text('会话平台', 'Conversation platform')} value={platform} onChange={(event) => setPlatform(event.target.value as Session['platform'])} disabled={disabled}>{platforms.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <input aria-label={text('会话 ID', 'Conversation ID')} value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder={text('粘贴会话 ID', 'Paste a conversation ID')} disabled={disabled} />
      <button type="submit" className="icon-button tiny" title={text('关联会话', 'Link conversation')} aria-label={text('关联会话', 'Link conversation')} disabled={disabled || !sessionId.trim()}><Plus size={15} /></button>
    </form>
    {error ? <ErrorMessage error={error} /> : null}
    {notice && <p className="muted-copy" role="status">{notice}</p>}
    {task.sessions.length === 0 ? <p className="muted-copy">{text('没有关联会话', 'No linked conversations')}</p> : <div className="session-list">{task.sessions.map((session) => <div className="session-row" key={session.id}>
      <span className="session-platform">{session.platform}</span><span title={session.sessionId}>{session.sessionId}</span>
      {host && session.platform === 'codex' && <button type="button" className="icon-button tiny" title={text('在 Codex 打开', 'Open in Codex')} aria-label={text('在 Codex 打开', 'Open in Codex')} disabled={busy || snapshot?.capabilities.openConversation.state !== 'supported'} onClick={() => void run(async () => { await host.openConversation(session); })}><ExternalLink size={14} /></button>}
      <button type="button" className="icon-button tiny danger-button" title={text('移除会话', 'Remove conversation')} aria-label={text('移除会话', 'Remove conversation')} onClick={() => void remove(session)} disabled={busy}><Trash2 size={13} /></button>
    </div>)}</div>}
    {host && task.sessions.some((session) => session.platform === 'codex') && snapshot?.capabilities.openConversation.state !== 'supported' && <p className="muted-copy">{text('当前宿主暂不支持打开关联对话。', 'Opening linked conversations is unavailable in this host.')}</p>}
  </section>;
}
