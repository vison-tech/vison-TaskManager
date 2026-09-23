import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Link2, RefreshCw, Search } from 'lucide-react';
import type { JiraCapabilities, JiraIssue } from '../../../../packages/contracts/index.ts';
import { api } from '../api';
import { ErrorMessage } from './shared';

export function JiraPanel() {
  const [capabilities, setCapabilities] = useState<JiraCapabilities | null>(null);
  const [connection, setConnection] = useState<{ displayName: string | null; accountId: string | null } | null>(null);
  const [issueKey, setIssueKey] = useState('');
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { let alive = true; void api.jiraCapabilities().then((value) => { if (alive) setCapabilities(value); }).catch((value) => { if (alive) setError(value); }); return () => { alive = false; }; }, []);

  async function testConnection() {
    setBusy(true); setError(null);
    try { setConnection(await api.jiraTestConnection()); }
    catch (value) { setError(value); } finally { setBusy(false); }
  }

  async function readIssue(event: FormEvent) {
    event.preventDefault(); if (!issueKey.trim()) return;
    setBusy(true); setError(null);
    try { setIssue(await api.jiraIssue(issueKey.trim())); }
    catch (value) { setIssue(null); setError(value); } finally { setBusy(false); }
  }

  return <section className="jira-panel">
    <div className="section-heading"><h3><Link2 size={14} />Jira 连接</h3>{capabilities?.configured && <span className="jira-state">已配置</span>}</div>
    {!capabilities ? <p className="muted-copy">正在读取连接能力…</p> : !capabilities.configured ? <p className="muted-copy">当前实例未配置 Jira 凭证。设置 `TASKMANAGER_JIRA_BASE_URL`、`TASKMANAGER_JIRA_EMAIL` 和 `TASKMANAGER_JIRA_API_TOKEN` 后可测试连接。</p> : <>
      <div className="jira-connection-meta"><span>{capabilities.baseUrl}</span>{capabilities.projectKey && <span>项目 {capabilities.projectKey}</span>}<button type="button" className="button secondary" onClick={() => void testConnection()} disabled={busy}><RefreshCw size={13} />测试连接</button></div>
      {connection && <div className="jira-success" role="status">已连接{connection.displayName ? `：${connection.displayName}` : ''}</div>}
      <form className="jira-issue-form" onSubmit={(event) => void readIssue(event)}><label>读取 Jira Issue<input value={issueKey} onChange={(event) => setIssueKey(event.target.value)} placeholder="例如 PROJ-123" maxLength={100} /></label><button type="submit" className="button secondary" disabled={busy || !issueKey.trim()}><Search size={13} />读取</button></form>
      {issue && <article className="jira-issue"><div className="jira-issue-head"><strong>{issue.key} · {issue.summary}</strong><a href={issue.url} target="_blank" rel="noreferrer" aria-label="在 Jira 中打开"><ExternalLink size={13} /></a></div><div className="jira-issue-meta"><span>{issue.status}</span>{issue.priority && <span>{issue.priority}</span>}{issue.assignee && <span>{issue.assignee}</span>}{issue.dueDate && <span>截止 {issue.dueDate}</span>}</div>{issue.description && <p>{issue.description}</p>}</article>}
    </>}
    <ErrorMessage error={error} />
  </section>;
}
