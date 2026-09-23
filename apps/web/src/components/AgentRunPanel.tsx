import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Paperclip, Play, RefreshCw, Square, Terminal } from 'lucide-react';
import type { AgentCapabilities, AgentSkill, Attachment, Task } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { ErrorMessage } from './shared';

type AgentEvent = { sequence: number; runId: string; type: string; data?: string; exitCode?: number | null; signal?: string | null; createdAt: string };
type AgentRun = { runId: string; sessionId: string; status: string; startedAt: string; finishedAt?: string; exitCode?: number | null; signal?: string | null };
type ChatMessage = { id: string; role: 'user' | 'agent' | 'system'; content: string; createdAt: string; runId?: string; sequence?: number };

const maxMessages = 100;

function storageKey(taskId: string, sessionId: string) { return `taskmanager.agent-chat.${taskId}.${encodeURIComponent(sessionId)}`; }

function readMessages(taskId: string, sessionId: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(taskId, sessionId)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChatMessage => !!item && typeof item === 'object' && ['user', 'agent', 'system'].includes((item as ChatMessage).role) && typeof (item as ChatMessage).content === 'string').slice(-maxMessages);
  } catch { return []; }
}

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

function now() { return new Date().toISOString(); }

export function AgentRunPanel({ task, attachments = [] }: { task: Task; attachments?: Attachment[] }) {
  const [open, setOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [sessionId, setSessionId] = useState(task.sessions[0]?.sessionId ?? task.identifier);
  const [command, setCommand] = useState('');
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState<'read' | 'write' | 'full'>('read');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const nextSession = task.sessions[0]?.sessionId ?? task.identifier;
    setSessionId(nextSession);
    setRun(null);
    setEvents([]);
    setMessages(readMessages(task.id, nextSession));
  }, [task.id, task.identifier, task.sessions]);

  useEffect(() => {
    if (!open || capabilities) return;
    void api.agentCapabilities().then((value) => { setCapabilities(value); setCommand(value.commands[0] ?? ''); setModel(value.models[0] ?? ''); setPermissionMode(value.permissionModes[0] ?? 'read'); }).catch(setError);
  }, [capabilities, open]);

  useEffect(() => {
    try { localStorage.setItem(storageKey(task.id, sessionId), JSON.stringify(messages.slice(-maxMessages))); } catch { /* Local storage is optional; the service remains authoritative. */ }
  }, [messages, sessionId, task.id]);

  useEffect(() => {
    if (!open || !sessionId.trim()) return;
    let alive = true;
    let savedRunId: string | null = null;
    try { savedRunId = localStorage.getItem(`${storageKey(task.id, sessionId)}.run`); } catch { /* Ignore unavailable storage. */ }
    if (!savedRunId) return;
    void api.getAgentRun(savedRunId).then(async (value) => {
      if (!alive) return;
      setRun(value as AgentRun);
      const replay = await api.agentEvents(savedRunId!);
      if (alive) setEvents(replay.items as AgentEvent[]);
    }).catch(() => { try { localStorage.removeItem(`${storageKey(task.id, sessionId)}.run`); } catch { /* Ignore unavailable storage. */ } });
    return () => { alive = false; };
  }, [open, sessionId, task.id]);

  const sortedEvents = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const terminal = !!run && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status);

  function appendMessage(message: Omit<ChatMessage, 'id' | 'createdAt'> & { createdAt?: string }) {
    setMessages((current) => {
      if (message.runId && message.sequence !== undefined && current.some((item) => item.runId === message.runId && item.sequence === message.sequence)) return current;
      return [...current, { ...message, id: crypto.randomUUID(), createdAt: message.createdAt ?? now() }].slice(-maxMessages);
    });
  }

  useEffect(() => {
    if (!run || terminal) return;
    const source = new EventSource(api.agentEventsUrl(run.runId, sortedEvents.at(-1)?.sequence ?? 0));
    const listener = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as AgentEvent;
        setEvents((current) => current.some((item) => item.sequence === event.sequence) ? current : [...current, event]);
        if (event.type === 'stdout' || event.type === 'stderr') appendMessage({ role: 'agent', content: event.data ?? '', runId: event.runId, sequence: event.sequence, createdAt: event.createdAt });
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type)) {
          appendMessage({ role: 'system', content: event.type === 'completed' ? '运行已完成。' : `运行结束：${event.type}。`, runId: event.runId, sequence: event.sequence, createdAt: event.createdAt });
          source.close();
          void api.getAgentRun(run.runId).then((value) => setRun(value as AgentRun)).catch(setError);
        }
      } catch { /* Ignore malformed events; the polling state remains authoritative. */ }
    };
    source.addEventListener('agent', listener);
    source.onerror = () => source.close();
    return () => { source.removeEventListener('agent', listener); source.close(); };
  }, [run?.runId, sortedEvents.at(-1)?.sequence]);

  function rememberRun(value: AgentRun) {
    setRun(value);
    try { localStorage.setItem(`${storageKey(task.id, sessionId)}.run`, value.runId); } catch { /* Ignore unavailable storage. */ }
  }

  function applySlashCommand() {
    const commandText = input.trim();
    if (commandText === '/context') { setInput(contextPrompt(task, attachments, selectedAttachmentIds, '请基于以上任务上下文继续。')); return true; }
    if (commandText === '/attach') { setSelectedAttachmentIds(attachments.map((item) => item.id)); setInput(''); return true; }
    return false;
  }

  async function start(event?: FormEvent) {
    event?.preventDefault();
    if (applySlashCommand() || !command || !sessionId.trim()) return;
    setBusy(true); setError(null); setEvents([]);
    const rawInput = input.trim();
    appendMessage({ role: 'user', content: rawInput || '请基于任务上下文开始工作。' });
    try { rememberRun(await api.startAgentRun({ sessionId: sessionId.trim(), command, model: model || undefined, permissionMode, skillIds, input: contextPrompt(task, attachments, selectedAttachmentIds, rawInput || '请基于任务上下文开始工作。') }) as AgentRun); setInput(''); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function cancel() {
    if (!run) return;
    setBusy(true); try { setRun(await api.cancelAgentRun(run.runId) as AgentRun); } catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function continueRun(event?: FormEvent) {
    event?.preventDefault();
    if (!run || applySlashCommand()) return;
    setBusy(true); setError(null); setEvents([]);
    const rawInput = input.trim();
    appendMessage({ role: 'user', content: rawInput || '请继续。' });
    try { rememberRun(await api.continueAgentRun(run.runId, contextPrompt(task, attachments, selectedAttachmentIds, rawInput || '请继续。')) as AgentRun); setInput(''); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  function toggleSkill(skill: AgentSkill) { setSkillIds((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id]); }
  function toggleAttachment(attachment: Attachment) { setSelectedAttachmentIds((current) => current.includes(attachment.id) ? current.filter((id) => id !== attachment.id) : [...current, attachment.id]); }

  return <section className="aside-section agent-run-section"><div className="section-heading"><h3><Terminal size={14} />AI 对话与本地 Agent</h3><button type="button" className="icon-button tiny" aria-label={open ? '收起 Agent 运行' : '展开 Agent 运行'} title={open ? '收起 Agent 运行' : '展开 Agent 运行'} onClick={() => setOpen((value) => !value)}><Terminal size={14} /></button></div>{!open ? <p className="muted-copy">仅使用实例明确允许的本地命令；任务状态不会随运行自动完成。</p> : <div className="agent-run-panel">
    {!capabilities ? <p className="muted-copy">正在读取运行能力…</p> : capabilities.commands.length === 0 ? <p className="muted-copy">当前实例没有配置 allowlist 命令，AI 对话不可用。</p> : <>
      <label>会话 ID<input value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={!!run && !terminal} /></label>
      <label>命令<select value={command} onChange={(event) => setCommand(event.target.value)} disabled={!!run && !terminal}>{capabilities.commands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {capabilities.models.length > 0 && <label>模型<select value={model} onChange={(event) => setModel(event.target.value)} disabled={!!run && !terminal}><option value="">默认</option>{capabilities.models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
      <label>权限<select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)} disabled={!!run && !terminal}>{capabilities.permissionModes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {capabilities.skills.length > 0 && <div className="agent-skills"><span>技能</span>{capabilities.skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={() => toggleSkill(skill)} disabled={!!run && !terminal} />{skill.name}</label>)}</div>}
      {attachments.length > 0 && <div className="agent-attachments"><span>加入上下文的附件</span>{attachments.map((attachment) => <label key={attachment.id}><input type="checkbox" checked={selectedAttachmentIds.includes(attachment.id)} onChange={() => toggleAttachment(attachment)} disabled={!!run && !terminal} /><Paperclip size={12} />{attachment.filename}</label>)}<small>仅发送文件名、类型、大小和本地 API 链接；运行时是否能读取由命令权限决定。</small></div>}
      <form className="agent-chat-form" onSubmit={(event) => void (terminal ? continueRun(event) : start(event))}><label>消息<textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入任务请求；/context 插入任务摘要，/attach 选中全部附件" disabled={!!run && !terminal} /></label>{!run ? <button type="submit" className="button primary" disabled={busy || !command || !sessionId.trim()}><Play size={14} />启动对话</button> : terminal ? <button type="submit" className="button secondary" disabled={busy}><RefreshCw size={14} />继续对话</button> : <button type="button" className="button secondary" onClick={() => void cancel()} disabled={busy}><Square size={14} />停止</button>}</form>
      <div className="agent-capability-note"><Check size={13} />已支持：任务上下文、附件元数据、技能选择、流式事件、停止与继续。<span>压缩/摘要需要运行时声明模型能力，当前实例未提供。</span></div>
      {run && <div className="agent-run-status"><span>{run.status}</span><code>{run.runId}</code></div>}
      {messages.length > 0 && <div className="agent-chat-log" aria-label="AI 对话记录">{messages.map((message) => <article className={`agent-chat-message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? '你' : message.role === 'agent' ? 'Agent' : '系统'}</strong><pre>{message.content}</pre></article>)}</div>}
      {sortedEvents.length > 0 && <details className="agent-events-details"><summary>原始运行事件（{sortedEvents.length}）</summary><pre className="agent-events" aria-label="Agent 运行事件">{sortedEvents.map((event) => `[${event.type}] ${event.data ?? ''}`).join('\n')}</pre></details>}
    </>}
    <ErrorMessage error={error} />
  </div>}</section>;
}
