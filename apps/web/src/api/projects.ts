import type { Project } from '../../../../packages/contracts/index.ts';
import { client } from './client';

export const projectApi = {
  snapshot: () => client.snapshot(),
  projects: () => client.listProjects(),
  createProject: (input: { name: string; prefix?: string; workspacePath?: string | null }) => client.createProject(input),
  updateProject: (project: Project, input: Partial<Pick<Project, 'name' | 'workspacePath' | 'labels' | 'readme'>>) => client.updateProject(project.id, { ...input, version: project.version }),
  deleteProject: (project: Project) => client.deleteProject(project.id, project.version),
};
