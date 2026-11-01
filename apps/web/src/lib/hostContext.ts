import type { Project, SessionRef, Task } from '../../../../packages/contracts/index.ts';
import type { EmbeddedHostContext, EmbeddedHostSnapshot } from '../../../../packages/contracts/embeddedHost.ts';

export function normalizeWorkspacePath(value: string | null | undefined): string {
  const path = value?.trim() ?? '';
  if (!path || /[\u0000-\u001f]/.test(path)) return '';
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  const normalized = windows ? path.replace(/\\/g, '/') : path;
  const withoutTrailing = normalized.replace(/\/+$/, '') || (normalized.startsWith('/') ? '/' : '');
  return windows ? withoutTrailing[0].toLowerCase() + withoutTrailing.slice(1) : withoutTrailing;
}

export type HostProjectMatch = { state: 'matched'; project: Project } | { state: 'missing' | 'unmatched' | 'ambiguous' | 'remote' };
export function matchHostProject(projects: Project[], context: EmbeddedHostContext | undefined): HostProjectMatch {
  if (context?.projectKind === 'remote' || (context?.hostId && context.hostId !== 'local')) return { state: 'remote' };
  const path = normalizeWorkspacePath(context?.workspacePath);
  if (!path) return { state: 'missing' };
  const matches = projects.filter((project) => normalizeWorkspacePath(project.workspacePath) === path);
  return matches.length === 1 ? { state: 'matched', project: matches[0] } : { state: matches.length > 1 ? 'ambiguous' : 'unmatched' };
}

export function currentHostSession(snapshot: EmbeddedHostSnapshot | null): SessionRef | null {
  const context = snapshot?.context;
  if (!context || snapshot?.capabilities.readContext.state !== 'supported' || !context.sessionId) return null;
  return {
    platform: 'codex', sessionId: context.sessionId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.hostId ? { hostId: context.hostId } : {}),
    ...(context.projectKind ? { projectKind: context.projectKind } : {}),
    ...(context.workspacePath ? { workspacePath: context.workspacePath } : {}),
  };
}

export function hasTaskSession(task: Task, session: SessionRef | null): boolean {
  return !!session && task.sessions.some((item) => item.platform === session.platform && item.sessionId === session.sessionId);
}

/** Drafts contain stable task text only; capability links must never leave the embedded document. */
export function taskConversationDraft(task: Task): string {
  const removeCapabilities = (text: string) => text.replace(/(?:https?:\/\/[^\s<>"'()[\]]+)?\/_embed\/[a-f0-9]{64}(?:\/[^\s<>"'()[\]]*)?/gi, '[临时链接已省略]');
  const title = removeCapabilities(`${task.identifier} · ${task.title}`);
  const description = removeCapabilities(task.description).trim();
  const workspace = task.developmentContext ? removeCapabilities(`开发上下文：${task.developmentContext.type} · ${task.developmentContext.path ?? task.developmentContext.branch ?? ''}${task.developmentContext.path && task.developmentContext.branch ? ` · ${task.developmentContext.branch}` : ''}`) : '';
  return [title, description, workspace].filter(Boolean).join('\n\n').slice(0, 8000);
}
