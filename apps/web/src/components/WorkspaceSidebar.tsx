import { useState } from 'react';
import { CheckCheck, FolderKanban, Inbox, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import type { Project } from '../../../../packages/contracts/index.ts';
import { initial } from '../lib/format';
import { useWorkspaceHistory } from '../hooks/useWorkspaceHistory';
import { useLocale } from '../lib/locale';

export function Sidebar({ projects, activeProject, revision, onSelect, onCreate, onPreferences }: { projects: Project[]; activeProject: Project | null; revision?: number; onSelect: (project: Project) => void; onCreate: () => void; onPreferences: () => void }) {
  const { text } = useLocale();
  const history = useWorkspaceHistory(activeProject?.id, revision);
  const [inboxOpen, setInboxOpen] = useState(false);
  const recentProjects = history.recentProjectIds.flatMap((id) => {
    const project = projects.find((item) => item.id === id);
    return project ? [project] : [];
  });

  function projectLink(project: Project) {
    return <button key={project.id} className={`project-link ${activeProject?.id === project.id ? 'active' : ''}`} onClick={() => onSelect(project)} aria-current={activeProject?.id === project.id ? 'page' : undefined}><span className="project-glyph">{initial(project.name)}</span><span className="project-name">{project.name}</span><span className="project-count">{project.taskCount}</span></button>;
  }

  return <aside className="sidebar">
    <div className="brand"><div className="brand-icon"><FolderKanban size={18} /></div><span>TaskManager</span><span className="brand-version">LOCAL</span></div>
    <div className="sidebar-projects">
      {recentProjects.length > 0 && <div className="sidebar-section"><div className="section-label"><span>{text('最近项目', 'Recent projects')}</span></div><nav className="project-nav" aria-label={text('最近项目', 'Recent projects')}>{recentProjects.map(projectLink)}</nav></div>}
      <div className="sidebar-section"><div className="section-label"><span>{text('所有项目', 'All projects')}</span><button className="icon-button tiny" aria-label={text('新建项目', 'New project')} title={text('新建项目', 'New project')} onClick={onCreate}><Plus size={15} /></button></div><nav className="project-nav" aria-label={text('所有项目', 'All projects')}>{projects.map(projectLink)}{projects.length === 0 && <div className="sidebar-empty">{text('还没有项目', 'No projects yet')}</div>}</nav><button className="new-project-link" onClick={onCreate}><Plus size={15} />{text('新建项目', 'New project')}</button></div>
    </div>
    <div className="sidebar-bottom">
      <button className="sidebar-link" aria-expanded={inboxOpen} aria-controls="workspace-inbox" onClick={() => setInboxOpen((value) => !value)}><Inbox size={16} />{text('收件箱', 'Inbox')}<span className={`sidebar-link-count ${history.unreadCount ? 'unread-count' : ''}`} aria-label={`${history.unreadCount} ${text('次未读更新', 'unread updates')}`}>{history.unreadCount > 99 ? '99+' : history.unreadCount}</span></button>
      {inboxOpen && <section className="workspace-inbox" id="workspace-inbox" aria-label={text('工作区未读更新', 'Workspace unread updates')}><p role="status">{history.unreadCount ? text(`自上次已读后，工作区有 ${history.unreadCount} 次更新。`, `There ${history.unreadCount === 1 ? 'is' : 'are'} ${history.unreadCount} update${history.unreadCount === 1 ? '' : 's'} since you last read.`) : text('暂无未读更新。', 'No unread updates.')}</p><small>{text('记录项目、任务和协作的更新次数；已读位置保存在此浏览器。', 'Counts project, task and collaboration updates; the read position is saved in this browser.')}</small><button className="sidebar-link" disabled={!history.unreadCount} onClick={history.markRead}><CheckCheck size={15} />{text('全部标为已读', 'Mark all read')}</button></section>}
      <button className="sidebar-link" onClick={onPreferences}><SlidersHorizontal size={16} />{text('偏好设置', 'Preferences')}</button>
      <div className="connection-card"><span className="connection-light" /><div><strong>{text('本地模式', 'Local mode')}</strong><span>{text('数据保存在本机', 'Data stays on this device')}</span></div><MoreHorizontal size={15} /></div>
    </div>
  </aside>;
}
