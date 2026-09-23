import { useEffect, useState } from 'react';
import { AlarmClock, ChevronDown, CircleAlert, LoaderCircle, Play, Power, Trash2 } from 'lucide-react';
import type { AgentCapabilities, Automation, AutomationRun } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { ErrorMessage } from './shared';

const defaultIntervalSeconds = 3600;

export function AutomationsPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Automation[]>([]);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [quota, setQuota] = useState<{ status: string; reason: string } | null>(null);
  const [runs, setRuns] = useState<Record<string, AutomationRun[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState('定时 Agent 任务');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [command, setCommand] = useState('');
  const [sessionId, setSessionId] = useState('automation');
  const [input, setInput] = useState('');
  const [model, setModel] = useState('');
  const [permissionMode, setPermissionMode] = useState<'read' | 'write' | 'full'>('read');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function reload() {
    const next = await api.listAutomations(projectId);
    setItems(next);
    if (!command && capabilities?.commands[0]) setCommand(capabilities.commands[0]);
  }

  useEffect(() => {
    let alive = true;
    setError(null);
    void Promise.all([api.listAutomations(projectId), api.agentCapabilities(), api.automationCapabilities()]).then(([automations, agent, scheduler]) => {
      if (!alive) return;
      setItems(automations);
      setCapabilities(agent);
      setQuota(scheduler.quota);
      setCommand((current) => current || agent.commands[0] || '');
      setPermissionMode((current) => agent.permissionModes.includes(current) ? current : agent.permissionModes[0] ?? 'read');
    }).catch((value) => { if (alive) setError(value); });
    return () => { alive = false; };
  }, [projectId]);

  async function create() {
    if (!name.trim() || !command || !sessionId.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.createAutomation({ projectId, name: name.trim(), enabled: true, intervalSeconds: Math.max(60, Math.round(intervalMinutes * 60)), command, sessionId: sessionId.trim(), input, model: model.trim() || undefined, permissionMode, skillIds });
      await reload();
      setInput('');
    } catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function toggle(item: Automation) {
    setBusy(true); setError(null);
    try { const updated = await api.updateAutomation(item.id, { version: item.version, enabled: !item.enabled }); setItems((current) => current.map((value) => value.id === updated.id ? updated : value)); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function run(item: Automation) {
    setBusy(true); setError(null);
    try { await api.runAutomation(item.id); await loadRuns(item.id); await reload(); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function remove(item: Automation) {
    if (!window.confirm(`删除自动化“${item.name}”？`)) return;
    setBusy(true); setError(null);
    try { await api.deleteAutomation(item.id, item.version); setItems((current) => current.filter((value) => value.id !== item.id)); setRuns((current) => { const next = { ...current }; delete next[item.id]; return next; }); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function loadRuns(id: string) {
    try { const nextRuns = await api.listAutomationRuns(id); setRuns((current) => ({ ...current, [id]: nextRuns })); }
    catch (value) { setError(value); }
  }

  async function expand(item: Automation) {
    const next = expanded === item.id ? null : item.id;
    setExpanded(next);
    if (next && !runs[item.id]) await loadRuns(item.id);
  }

  const unavailable = !capabilities || capabilities.commands.length === 0;
  return <section className="project-automations">
    <div className="section-heading"><h3><AlarmClock size={14} />自动化 <span>{items.length}</span></h3><span className="automation-scheduler-state">本地调度</span></div>
    <p className="muted-copy">按固定间隔启动已允许的本地命令；任务不会因自动化运行自动标记完成。</p>
    {quota && <div className="automation-capability-note"><CircleAlert size={14} />配额状态：{quota.status === 'unknown' ? '未知' : quota.status}。{quota.reason}</div>}
    {unavailable ? <div className="automation-empty">当前实例没有配置 Agent allowlist 命令，先配置 <code>TASKMANAGER_AGENT_COMMANDS</code> 后再创建自动化。</div> : <div className="automation-create-form">
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={500} /></label>
      <label>间隔（分钟）<input type="number" min={1} max={10080} value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value) || 1)} /></label>
      <label>命令<select value={command} onChange={(event) => setCommand(event.target.value)}>{capabilities?.commands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>会话 ID<input value={sessionId} onChange={(event) => setSessionId(event.target.value)} maxLength={500} /></label>
      <label>权限<select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}>{capabilities?.permissionModes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {capabilities.models.length > 0 ? <label>模型策略（可选）<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">默认</option>{capabilities.models.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : <label>模型策略<span className="field-hint">当前实例未声明可用模型，留空由命令自行决定</span><input value="" readOnly placeholder="未声明" /></label>}
      {capabilities.skills.length > 0 && <div className="automation-skills"><span>技能</span>{capabilities.skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={() => setSkillIds((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />{skill.name}</label>)}</div>}
      <label className="automation-input-field">启动输入<textarea rows={2} value={input} onChange={(event) => setInput(event.target.value)} placeholder="传给本地 Agent 的固定输入" maxLength={1_000_000} /></label>
      <button type="button" className="button primary automation-create-button" onClick={() => void create()} disabled={busy || !name.trim() || !sessionId.trim() || !command}><Power size={14} />创建自动化</button>
    </div>}
    {items.length > 0 && <div className="automation-list">{items.map((item) => <article className={`automation-row ${item.enabled ? '' : 'paused'}`} key={item.id}>
      <div className="automation-row-main"><div className="automation-row-title"><strong>{item.name}</strong><span>{item.enabled ? '运行中' : '已暂停'}</span></div><small>每 {Math.round(item.intervalSeconds / 60)} 分钟 · 下次 {formatDate(item.nextRunAt)}</small></div>
      <div className="automation-row-actions"><button type="button" className="icon-button tiny" title={item.enabled ? '暂停自动化' : '启用自动化'} aria-label={item.enabled ? '暂停自动化' : '启用自动化'} onClick={() => void toggle(item)} disabled={busy}><Power size={13} /></button><button type="button" className="icon-button tiny" title="立即运行" aria-label="立即运行" onClick={() => void run(item)} disabled={busy || !item.enabled}><Play size={13} /></button><button type="button" className="icon-button tiny" title="运行记录" aria-label="运行记录" onClick={() => void expand(item)}><ChevronDown size={13} className={expanded === item.id ? 'rotated' : ''} /></button><button type="button" className="icon-button tiny danger-button" title="删除自动化" aria-label="删除自动化" onClick={() => void remove(item)} disabled={busy}><Trash2 size={13} /></button></div>
      {expanded === item.id && <div className="automation-runs">{(runs[item.id] ?? []).length === 0 ? <span className="muted-copy">还没有运行记录。</span> : runs[item.id].map((runItem) => <div className="automation-run" key={runItem.id}><span className={`automation-run-status ${runItem.status}`}>{runItem.status}</span><span>{formatDate(runItem.createdAt)}</span><code>{runItem.reason || runItem.runId || runItem.triggerKey}</code></div>)}</div>}
    </article>)}</div>}
    <ErrorMessage error={error} />
  </section>;
}

function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); }
