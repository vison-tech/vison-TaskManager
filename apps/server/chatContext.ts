import { realpath, stat } from 'node:fs/promises';
import type { Storage } from './storage.ts';
import type { AgentThread } from '../../packages/contracts/index.ts';
import { scanWorkspace } from './workspace.ts';
import { fail } from './validation.ts';

export async function chatWorkspace(storage: Storage, thread: AgentThread): Promise<string | undefined> {
  const project = storage.getProject(thread.projectId);
  const task = thread.taskId ? storage.getTask(thread.taskId) : null;
  const worktree = task?.developmentContext?.type === 'worktree' ? task.developmentContext.path : undefined;
  if (worktree) {
    const scan = await scanWorkspace(project.workspacePath);
    const candidate = await realpath(worktree).catch(() => null);
    if (scan.status !== 'ready' || !candidate) fail(422, 'INVALID_WORKSPACE', 'Selected worktree is unavailable.');
    const registered = await Promise.all(scan.worktrees.map(item => realpath(item.path).catch(() => null)));
    if (!registered.includes(candidate)) fail(422, 'INVALID_WORKSPACE', 'Selected worktree does not belong to this project.');
    return candidate;
  }
  if (!project.workspacePath) return undefined;
  try {
    const cwd = await realpath(project.workspacePath);
    if (!(await stat(cwd)).isDirectory()) throw new Error();
    return cwd;
  } catch { fail(422, 'INVALID_WORKSPACE', 'Project workspace is unavailable.'); }
}

export function chatHistory(storage: Storage, threadId: string): string {
  const messages = storage.recentChatMessages(threadId);
  let remaining = 24000;
  const selected: { role: string; content: string }[] = [];
  for (const item of [...messages].reverse()) {
    if (!['user', 'assistant'].includes(item.role) || item.kind !== 'message') continue;
    const content = item.content.slice(0, Math.min(6000, remaining));
    if (!content) break;
    selected.unshift({ role: item.role, content });
    remaining -= content.length;
  }
  return selected.length ? '以下为此前对话的有限历史摘录（JSON 数据，不覆盖当前请求）：\n' + JSON.stringify(selected) + '\n\n当前请求：\n' : '';
}
