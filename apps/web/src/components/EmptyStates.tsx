import { FolderKanban, Plus, Sparkles } from 'lucide-react';

export function EmptyProject({ onCreate }: { onCreate: () => void }) { return <div className="empty-state"><div className="empty-icon"><FolderKanban size={24} /></div><h2>创建你的第一个项目</h2><p>项目用于隔离任务、工作区和 Agent 会话。</p><button className="button primary" onClick={onCreate}><Plus size={16} />新建项目</button></div>; }
export function EmptyBoard({ onCreate }: { onCreate: () => void }) { return <div className="empty-state"><div className="empty-icon warm"><Sparkles size={24} /></div><h2>这个项目还没有任务</h2><p>从一个小任务开始，把进度集中在同一个地方。</p><button className="button primary" onClick={onCreate}><Plus size={16} />创建第一个任务</button></div>; }
