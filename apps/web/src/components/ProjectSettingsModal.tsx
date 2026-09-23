import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import type { Project, ProjectAttachment } from '../../../../packages/contracts/index.ts';
import { api, ApiError } from '../api';
import { ErrorMessage, Markdown, Modal } from './shared';
import { AutomationsPanel } from './AutomationsPanel';
import { JiraPanel } from './JiraPanel';

export function ProjectSettingsModal({ project, onClose, onSave, onDelete }: { project: Project; onClose: () => void; onSave: (input: { name: string; workspacePath: string | null; labels: string[]; readme: string; version: number }) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [workspacePath, setWorkspacePath] = useState(project.workspacePath ?? '');
  const [labels, setLabels] = useState(project.labels.join(', '));
  const [readme, setReadme] = useState(project.readme);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [baseVersion, setBaseVersion] = useState(project.version);
  const [conflictProject, setConflictProject] = useState<Project | null>(null);

  useEffect(() => { let alive = true; void api.projectAttachments(project).then((items) => { if (alive) setAttachments(items); }).catch(() => { /* Keep project settings usable when attachment listing fails. */ }); return () => { alive = false; }; }, [project]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('请输入项目名称'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), workspacePath: workspacePath.trim() || null, labels: [...new Set(labels.split(',').map((value) => value.trim()).filter(Boolean))], readme, version: baseVersion });
      setConflictProject(null);
    } catch (value) {
      if (value instanceof ApiError && value.code === 'VERSION_CONFLICT') {
        try {
          const latest = (await api.projects()).find((item) => item.id === project.id) ?? null;
          setConflictProject(latest);
          setError(latest ? '项目已被其他窗口修改。请选择载入最新版本，或继续保留当前草稿。' : displayError(value));
        } catch { setError(displayError(value)); }
      } else setError(displayError(value));
    } finally { setSaving(false); }
  }

  function useLatestVersion() {
    if (!conflictProject) return;
    setName(conflictProject.name);
    setWorkspacePath(conflictProject.workspacePath ?? '');
    setLabels(conflictProject.labels.join(', '));
    setReadme(conflictProject.readme);
    setBaseVersion(conflictProject.version);
    setConflictProject(null);
    setError(null);
  }

  async function removeProject() {
    if (!onDelete || !window.confirm(`永久删除项目“${project.name}”？此操作无法撤销。`)) return;
    setSaving(true);
    try { await onDelete(); } catch (value) { setError(displayError(value)); } finally { setSaving(false); }
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachmentBusy(true);
    try {
      const attachment = await api.uploadProjectAttachment(project, file);
      setAttachments((current) => [...current, attachment]);
      const url = api.projectAttachmentUrl(attachment.id);
      const markdown = file.type.startsWith('image/') ? `![${file.name}](${url})` : `[${file.name}](${url})`;
      setReadme((current) => `${current.trimEnd()}\n\n${markdown}`.trimStart());
    } catch (value) { setError(displayError(value)); } finally { setAttachmentBusy(false); event.target.value = ''; }
  }

  async function deleteAttachment(attachment: ProjectAttachment) {
    setAttachmentBusy(true);
    try { await api.deleteProjectAttachment(attachment.id); setAttachments((current) => current.filter((item) => item.id !== attachment.id)); const url = api.projectAttachmentUrl(attachment.id); setReadme((current) => current.split('\n').filter((line) => !line.includes(`](${url})`)).join('\n').replace(/\n{3,}/g, '\n\n').trim()); } catch (value) { setError(displayError(value)); } finally { setAttachmentBusy(false); }
  }

  return <Modal title={`${project.name} · 项目设置`} onClose={onClose} wide>
    <form className="project-settings-form" onSubmit={(event) => void submit(event)}>
      <div className="project-settings-fields">
        <label>项目名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={500} /></label>
        <label>工作区路径<span className="field-hint">只保存路径映射，不会自动执行命令</span><input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} maxLength={4096} placeholder="/Users/you/project" /></label>
        <label>项目标签<span className="field-hint">使用逗号分隔</span><input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="产品, 研发" /></label>
      </div>
      <AutomationsPanel projectId={project.id} />
      <JiraPanel />
      <section className="readme-editor"><div className="section-heading"><h3>README</h3><div className="view-switch" role="group" aria-label="README 视图"><button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>编辑</button><button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>预览</button></div></div>{preview ? <div className="readme-preview"><Markdown text={readme || '还没有 README 内容。'} /></div> : <textarea aria-label="README 内容" value={readme} onChange={(event) => setReadme(event.target.value)} placeholder="记录项目目标、约定和验收入口…" rows={12} maxLength={1_000_000} />}</section>
      <section className="project-attachments"><div className="section-heading"><h3>README 附件 <span>{attachments.length}</span></h3><label className="icon-button tiny upload-button" title="上传 README 附件" aria-label="上传 README 附件"><Upload size={15} /><input type="file" onChange={(event) => void uploadAttachment(event)} disabled={attachmentBusy} /></label></div>{attachments.length === 0 ? <p className="muted-copy">上传图片或文件后会自动插入 README 链接。</p> : <div className="attachment-list">{attachments.map((item) => <div className="attachment-row" key={item.id}><a href={api.projectAttachmentUrl(item.id)} target="_blank" rel="noreferrer"><Paperclip size={14} /><span>{item.filename}</span><small>{Math.ceil(item.size / 1024)} KB</small></a><button type="button" className="icon-button tiny danger-button" title="删除 README 附件" aria-label="删除 README 附件" onClick={() => void deleteAttachment(item)} disabled={attachmentBusy}><Trash2 size={13} /></button></div>)}</div>}</section>
      <ErrorMessage error={error} />
      {conflictProject && <div className="conflict-panel" role="alert"><strong>检测到更新冲突</strong><span>服务器版本为 v{conflictProject.version}，当前草稿仍保留在编辑器中。</span><div className="conflict-actions"><button type="button" className="button secondary" onClick={useLatestVersion}>载入服务器版本</button><button type="button" className="button secondary" onClick={() => { setConflictProject(null); setError(null); }}>继续编辑草稿</button></div></div>}
      <div className="form-actions"><button type="button" className="button danger" onClick={() => void removeProject()} disabled={saving || !onDelete}><Trash2 size={14} />删除项目</button><span className="form-actions-spacer" /><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></div>
    </form>
  </Modal>;
}

function displayError(value: unknown): unknown { return value instanceof ApiError && value.code === 'VERSION_CONFLICT' ? '项目已被其他窗口修改，当前草稿仍保留，请刷新后重试。' : value; }
