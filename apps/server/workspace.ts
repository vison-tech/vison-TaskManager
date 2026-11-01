import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { WorkspaceScan } from '../../packages/contracts/workspace.ts';
const execute = promisify(execFile);

export async function scanWorkspace(path: string | null): Promise<WorkspaceScan> {
  const empty = { branches: [], worktrees: [] };
  if (!path) return { ...empty, status: 'unconfigured', reason: '请先在项目设置中绑定工作区。' };
  if (!isAbsolute(path)) return { ...empty, status: 'unavailable', reason: '工作区必须是绝对路径。' };
  let cwd: string;
  try { cwd = await realpath(path); if (!(await stat(cwd)).isDirectory()) throw new Error(); }
  catch { return { ...empty, status: 'unavailable', reason: '工作区目录不存在或无法访问。' }; }
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT'].includes(key)) delete (env as NodeJS.ProcessEnv)[key];
  const git = async (...args: string[]) => (await execute('git', ['--no-optional-locks', '-C', cwd, ...args], { env, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
  try {
    const root = (await git('rev-parse', '--show-toplevel')).trim();
    const [branchText, treeText] = await Promise.all([git('for-each-ref', '--format=%(refname:short)', 'refs/heads/'), git('worktree', 'list', '--porcelain', '-z')]);
    const worktrees: WorkspaceScan['worktrees'] = [];
    let item: WorkspaceScan['worktrees'][number] | undefined;
    for (const field of treeText.split('\0')) {
      if (field.startsWith('worktree ')) { item = { path: field.slice(9), detached: false }; worktrees.push(item); }
      else if (field.startsWith('branch refs/heads/') && item) item.branch = field.slice(18);
      else if (field === 'detached' && item) item.detached = true;
    }
    return { status: 'ready', root, branches: branchText.trim().split('\n').filter(Boolean), worktrees };
  } catch (error) {
    const notRepo = String((error as { stderr?: string }).stderr ?? '').includes('not a git repository');
    return { ...empty, status: notRepo ? 'not_repository' : 'unavailable', reason: notRepo ? '该目录不是 Git 仓库。' : '无法读取 Git 工作区，请检查 Git 安装和目录权限。' };
  }
}
