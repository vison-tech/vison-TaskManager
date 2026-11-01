import { useEffect, useState } from 'react';
import type { Task } from '../../../../packages/contracts/index.ts';
import type { WorkspaceScan } from '../../../../packages/contracts/workspace.ts';
import { client } from '../api/client';
import { useLocale } from '../lib/locale';

type Context = Task['developmentContext'];
export function WorkspaceContextPicker({ projectId, value, onChange }: { projectId: string; value: Context; onChange: (value: Context) => void }) {
  const { text } = useLocale();
  const [scan, setScan] = useState<WorkspaceScan | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setScan(null); setError('');
    void client.scanWorkspace(projectId).then(result => { if (active) setScan(result); }).catch(() => { if (active) setError(text('无法加载工作区，请重试。', 'Unable to load workspace. Try again.')); });
    return () => { active = false; };
  }, [projectId, refresh]);
  const options: { label: string; context: NonNullable<Context> }[] = scan?.status === 'ready' ? [
    ...scan.branches.map(branch => ({ label: `${text('分支', 'Branch')} · ${branch}`, context: { type: 'branch' as const, branch } })),
    ...scan.worktrees.map(tree => ({ label: `Worktree · ${tree.path}${tree.detached ? ' (detached)' : ''}`, context: { type: 'worktree' as const, path: tree.path, ...(tree.branch ? { branch: tree.branch } : {}) } })),
  ] : [];
  const selected = value ? options.findIndex(option => option.context.type === value.type && (value.type === 'branch' ? option.context.branch === value.branch : option.context.path === value.path)) : -1;
  return <section className="workspace-context-picker"><label>{text('开发工作区', 'Development workspace')}<select value={value ? selected < 0 ? 'saved' : String(selected) : ''} onChange={event => onChange(event.target.value === '' ? null : options[Number(event.target.value)]?.context ?? value)}>
    <option value="">{text('使用项目默认工作区', 'Use project workspace')}</option>
    {value && selected < 0 && <option value="saved">{text('已保存', 'Saved')} · {value.path ?? value.branch}</option>}
    {options.map((option, index) => <option key={`${option.context.type}:${option.context.path ?? option.context.branch}`} value={index}>{option.label}</option>)}
  </select></label><p className="muted-copy" role="status">{error || (scan ? scan.reason ?? text('仅关联分支或工作树，不切换 Git 分支。', 'Links context without switching Git branches.') : text('正在扫描工作区…', 'Scanning workspace…'))}</p><button type="button" className="button secondary" onClick={() => setRefresh(n => n + 1)}>{text('刷新工作区', 'Refresh workspace')}</button></section>;
}
