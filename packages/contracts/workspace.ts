export interface WorkspaceScan {
  status: 'ready' | 'unconfigured' | 'unavailable' | 'not_repository';
  reason?: string;
  root?: string;
  branches: string[];
  worktrees: { path: string; branch?: string; detached: boolean }[];
}
