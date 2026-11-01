import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import type { Project } from '../../../../packages/contracts/index.ts';
import type { EmbeddedHostClient } from '../../../../packages/contracts/embeddedHost.ts';
import { embeddedHost, useEmbeddedHost } from '../lib/embeddedHost';
import { matchHostProject } from '../lib/hostContext';
import { useLocale } from '../lib/locale';
import { ErrorMessage } from './shared';

export function HostContextBar({ projects, selectedProjectId, onSelect, switchingBlocked = false, host = embeddedHost }: {
  projects: Project[]; selectedProjectId?: string; onSelect: (project: Project) => void; switchingBlocked?: boolean; host?: EmbeddedHostClient | null;
}) {
  const { text } = useLocale();
  const snapshot = useEmbeddedHost(host);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(false);
  const working = useRef(false);
  const latest = useRef({ projects, selectedProjectId, switchingBlocked, onSelect });
  latest.current = { projects, selectedProjectId, switchingBlocked, onSelect };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);


  async function refresh(select = false) {
    if (!host || working.current || (select && switchingBlocked)) return;
    const startingProjectId = selectedProjectId;
    working.current = true; setBusy(true); setError(null);
    try {
      const current = await host.refresh();
      if (!mounted.current || !select || latest.current.switchingBlocked || latest.current.selectedProjectId !== startingProjectId) return;
      const match = matchHostProject(latest.current.projects, current.capabilities.readContext.state === 'supported' ? current.context : undefined);
      if (match.state !== 'matched') throw new Error(text('当前工作区已变化，未找到唯一对应项目。', 'The workspace changed; there is no unique matching project.'));
      latest.current.onSelect(match.project);
    } catch (value) { if (mounted.current) setError(value); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }

  if (!host) return null;
  const match = matchHostProject(projects, snapshot?.capabilities.readContext.state === 'supported' ? snapshot.context : undefined);
  const message = !snapshot ? text('正在读取 Codex 工作区…', 'Reading the Codex workspace…')
    : snapshot.capabilities.readContext.state !== 'supported' ? text('当前 Codex 暂未提供工作区信息。', 'Workspace context is unavailable in this Codex window.')
    : match.state === 'matched' ? (match.project.id === selectedProjectId ? text('已显示当前工作区项目', 'Showing the current workspace project') : text(`当前工作区对应 ${match.project.name}`, `Current workspace: ${match.project.name}`))
    : match.state === 'ambiguous' ? text('多个项目使用此路径，请在侧栏选择。', 'Several projects use this path. Choose one in the sidebar.')
    : match.state === 'remote' ? text('当前为远程工作区，请手动选择项目。', 'This is a remote workspace. Select a project manually.')
    : match.state === 'unmatched' ? text('尚无匹配项目，可在项目设置中填写工作区路径。', 'No matching project. Set its workspace path in project settings.')
    : text('尚未获取工作区路径，仍可手动选择项目。', 'No workspace path is available. You can select a project manually.');
  return <section className="host-context-bar" aria-label={text('Codex 工作区', 'Codex workspace')}>
    <div className="host-context-copy"><strong>{message}</strong>{snapshot?.context.workspacePath && <span title={snapshot.context.workspacePath}>{snapshot.context.workspacePath}</span>}</div>
    <div className="host-context-actions">
      {match.state === 'matched' && match.project.id !== selectedProjectId && <button type="button" className="button secondary" onClick={() => void refresh(true)} disabled={busy || switchingBlocked} title={switchingBlocked ? text('关闭编辑窗口后切换', 'Close the editor before switching') : undefined}><ArrowRight size={14} />{text('切换到此项目', 'Switch to this project')}</button>}
      <button type="button" className="icon-button" aria-label={text('刷新 Codex 上下文', 'Refresh Codex context')} title={text('刷新 Codex 上下文', 'Refresh Codex context')} onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /></button>
    </div>
    {error ? <ErrorMessage error={error} /> : null}
  </section>;
}
