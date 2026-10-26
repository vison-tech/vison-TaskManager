import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, MessageSquarePlus, Paperclip, RefreshCw, Send, Square, Terminal, Wand } from 'lucide-react';
import type { AgentCatalog, AgentMessage, AgentThread, Attachment, Task } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { expandSlashCommand } from '../lib/agentCompletions';
import { mergeAgentMessages } from '../lib/agentMessages';
import { AgentComposer } from './AgentComposer';
import { ErrorMessage } from './shared';

function contextPrompt(task: Task, attachments: Attachment[], selectedAttachmentIds: string[], input: string): string {
  const selected = attachments.filter((item) => selectedAttachmentIds.includes(item.id));
  const lines = [
    `任务上下文（只读）：${task.identifier} · ${task.title}`,
    `状态：${task.status}；优先级：${task.priority}`,
    `标签：${task.labels.length ? task.labels.join(', ') : '无'}`,
    `描述：${task.description || '无'}`,
  ];
  if (selected.length) {
    lines.push('选中的附件：');
    for (const item of selected) lines.push(`- ${item.filename} (${item.contentType}, ${item.size} bytes): ${api.attachmentUrl(item)}`);
  }
  return `${lines.join('\n')}\n\n用户请求：\n${input.trim()}`;
}

const roleLabel: Record<AgentMessage['role'], string> = { user: '你', assistant: 'Agent', activity: '动作', system: '系统' };

function MessageBody({ message }: { message: AgentMessage }) {
  if (message.kind === 'command') return <pre><code>$ {message.content}</code></pre>;
  if (message.kind === 'file_change' || message.kind === 'tool_call') return <pre className="agent-activity">{message.content}</pre>;
  if (message.kind === 'summary') {
    const folded = (message.data as { foldedCount?: number; kept?: number } | null)?.foldedCount;
    return <div className="agent-summary"><strong>历史摘要 · 折叠了 {folded ?? 0} 条早期消息</strong><pre>{message.content}</pre></div>;
  }
  return <pre>{message.content}</pre>;
}

export function AiChatPanel({ task, attachments = [] }: { task: Task; attachments?: Attachment[] }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [command, setCommand] = useState('');
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState<'read' | 'write' | 'full'>('read');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const sessionId = useMemo(() => task.sessions[0]?.sessionId ?? task.identifier, [task.sessions, task.identifier]);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || catalog) return;
    void api.agentCatalog().then((value) => {
      setCatalog(value);
      setCommand(value.commands[0]?.id ?? '');
      setModel(value.models[0] ?? '');
      setPermissionMode(value.permissionModes[0] ?? 'read');
    }).catch(setError);
  }, [catalog, open]);

  // The newest persisted thread for this task is the conversation the panel resumes.
  const loadThread = useCallback(async () => {
    const items = await api.listAgentThreads({ taskId: task.id, limit: 1 });
    const existing = items[0];
    if (!existing) { setThread(null); setMessages([]); return; }
    setThread(existing);
    setCommand(existing.command ?? '');
    setModel(existing.model ?? '');
    setPermissionMode(existing.permissionMode);
    setSkillIds(existing.skillIds);
    setLastRunId(existing.lastRunId);
    // A reload can land mid-run, so the persisted run decides the button state rather than a guess.
    const lastRun = existing.lastRunId ? await api.getAgentRun(existing.lastRunId).catch(() => null) as { status?: string } | null : null;
    setRunning(lastRun?.status === 'running');
    setMessages((await api.agentMessagesPage(existing.id, { limit: 200 })).items);
  }, [task.id]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void loadThread().catch(setError);
  }, [open, loadThread]);

  useEffect(() => {
    if (!open || !thread) return;
    const source = new EventSource(api.agentMessagesUrl(thread.id, messages.at(-1)?.sequence ?? 0));
    const listener = (frame: MessageEvent<string>) => {
      try {
        const message = JSON.parse(frame.data) as AgentMessage;
        setMessages((current) => mergeAgentMessages(current, [message]));
        if (message.role === 'system' && message.kind !== 'error') setRunning(false);
      } catch { /* Ignore malformed frames; the next fetch remains authoritative. */ }
    };
    source.addEventListener('message', listener);
    source.onerror = () => source.close();
    return () => { source.removeEventListener('message', listener); source.close(); };
  }, [open, thread?.id]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages.length]);

  function applySlashCommand(): boolean {
    const command = expandSlashCommand(input, running);
    if (!command) return false;
    if (command === '/context') { setInput(contextPrompt(task, attachments, selectedAttachmentIds, '请基于以上任务上下文继续。')); return true; }
    if (command === '/attach') { setSelectedAttachmentIds(attachments.map((item) => item.id)); setInput(''); return true; }
    void stop();
    return true;
  }

  // Picking a mention adds the skill to the run settings, so the inserted text and the request agree.
  function rememberCandidate(candidate: { skillId?: string }) { if (candidate.skillId) setSkillIds((current) => current.includes(candidate.skillId!) ? current : [...current, candidate.skillId!]); }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (applySlashCommand()) return;
    const text = input.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      const active = thread ?? await api.createAgentThread({ projectId: task.projectId, taskId: task.id, sessionId, title: task.identifier, command: command || null, model: model || null, permissionMode, skillIds });
      setThread(active);
      const result = await api.agentTurn(active.id, { input: contextPrompt(task, attachments, selectedAttachmentIds, text), command: command || undefined, model: model || undefined, permissionMode, skillIds });
      setLastRunId((result.run as { runId?: string } | null)?.runId ?? null);
      setRunning(true);
      setInput('');
      const page = await api.agentMessagesPage(active.id, { limit: 200 });
      setMessages(page.items);
      setThread(result.thread);
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function stop() {
    if (!lastRunId) return;
    setBusy(true);
    try { await api.cancelAgentRun(lastRunId); } catch (value) { setError(value); } finally { setBusy(false); }
  }

  // Folding is a deterministic recount of the thread's own history; it is refused while a run is
  // active so the summary cannot race a live stream, and it never pretends to be model output.
  const compressible = !running && !compressing && messages.length > 2;
  async function compress() {
    if (!thread) return;
    setCompressing(true); setError(null);
    try {
      const result = await api.compressAgentThread(thread.id, { keep: 20 });
      setThread(result.thread);
      setMessages((await api.agentMessagesPage(result.thread.id, { limit: 200 })).items);
    } catch (value) { setError(value); } finally { setCompressing(false); }
  }

  async function newThread() {
    setBusy(true); setError(null);
    try {
      const created = await api.createAgentThread({ projectId: task.projectId, taskId: task.id, sessionId, title: task.identifier, command: command || null, model: model || null, permissionMode, skillIds });
      setThread(created); setMessages([]); setLastRunId(null); setRunning(false);
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  function toggleSkill(id: string) { setSkillIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function toggleAttachment(attachment: Attachment) { setSelectedAttachmentIds((current) => current.includes(attachment.id) ? current.filter((id) => id !== attachment.id) : [...current, attachment.id]); }

  const unavailable = catalog !== null && !catalog.available;

  return <section className="aside-section agent-run-section"><div className="section-heading"><h3><Terminal size={14} />AI 对话与本地 Agent</h3><button type="button" className="icon-button tiny" aria-label={open ? '收起 AI 对话' : '展开 AI 对话'} title={open ? '收起 AI 对话' : '展开 AI 对话'} onClick={() => setOpen((value) => !value)}><Terminal size={14} /></button></div>{!open ? <p className="muted-copy">对话保存在本项目数据库中；仅使用实例明确允许的本地命令，任务状态不会随运行自动完成。</p> : <div className="agent-run-panel">
    {!catalog ? <p className="muted-copy"><Loader2 size={13} /> 正在读取运行能力…</p> : unavailable ? <div className="agent-unavailable"><Terminal size={13} /><div><strong>AI 对话不可用</strong><p>{catalog.reason}</p><small>由实例启动方通过 TASKMANAGER_AGENT_COMMANDS 声明可用命令后即可启用。</small></div></div> : <>
      <div className="agent-thread-bar"><span className="muted-copy">{thread ? `线程 ${thread.title || thread.sessionId} · ${messages.length} 条消息` : '尚未开始对话'}</span><span className="agent-thread-actions"><button type="button" className="icon-button tiny" title={compressible ? '把早期消息折叠为一条历史摘要' : running ? '运行中不能压缩' : '消息太少，无需压缩'} aria-label="压缩历史" disabled={!compressible || compressing} onClick={() => void compress()}><Wand size={13} /></button><button type="button" className="icon-button tiny" title="新对话" aria-label="新对话" onClick={() => void newThread()} disabled={busy}><MessageSquarePlus size={13} /></button></span></div>
      <details className="agent-settings"><summary>运行设置</summary>
        <label>会话 ID<input value={thread?.sessionId ?? sessionId} readOnly /></label>
        <label>命令<select value={command} onChange={(event) => setCommand(event.target.value)} disabled={running}>{catalog.commands.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {catalog.models.length > 0 && <label>模型<select value={model} onChange={(event) => setModel(event.target.value)} disabled={running}><option value="">默认</option>{catalog.models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
        <label>权限<select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)} disabled={running}>{catalog.permissionModes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {catalog.skills.length > 0 && <div className="agent-skills"><span>技能</span>{catalog.skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} disabled={running} />{skill.name}</label>)}</div>}
        {attachments.length > 0 && <div className="agent-attachments"><span>加入上下文的附件</span>{attachments.map((attachment) => <label key={attachment.id}><input type="checkbox" checked={selectedAttachmentIds.includes(attachment.id)} onChange={() => toggleAttachment(attachment)} disabled={running} /><Paperclip size={12} />{attachment.filename}</label>)}<small>仅发送文件名、类型、大小和本地 API 链接；运行时是否能读取由命令权限决定。</small></div>}
      </details>
      <div className="agent-chat-log" ref={logRef} aria-label="AI 对话记录">
        {messages.length === 0 ? <p className="muted-copy">还没有消息。输入任务请求开始对话。</p> : messages.map((message) => <article className={`agent-chat-message ${message.role} kind-${message.kind}`} key={message.id}>
          <strong>{roleLabel[message.role]}{message.kind === 'error' ? ' · 错误' : ''}</strong>
          <MessageBody message={message} />
        </article>)}
      </div>
      <form className="agent-chat-form" onSubmit={(event) => void send(event)}>
        <label>消息<AgentComposer value={input} onChange={setInput} onSubmit={() => void send()} running={running} catalog={catalog} attachments={attachments} disabled={running} onCandidate={rememberCandidate} /></label>
        {running ? <button type="button" className="button secondary" onClick={() => void stop()} disabled={busy}><Square size={14} />停止</button> : <button type="submit" className="button primary" disabled={busy || !input.trim() || !command}><Send size={14} />发送</button>}
      </form>
      <div className="agent-capability-note"><Check size={13} />消息保存在服务端并可按序回放；事件流模式为 {catalog.stream}；压缩为确定性历史折叠，无模型能力时不会伪造摘要。{compressing && <Loader2 size={13} />}<span>{catalog.slashCommands.map((item) => item.name).join(' ')}</span></div>
      {thread && <div className="agent-run-status"><span>{running ? 'running' : 'idle'}</span><code>{thread.id}</code></div>}
    </>}
    <ErrorMessage error={error} />
  </div>}</section>;
}

export { AiChatPanel as AgentRunPanel };
