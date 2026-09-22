import type { Attachment, Comment, Project, Relation, Session, Task, TaskInput, TaskPatch } from '../../../packages/contracts/index.ts';
import { ApiError, TaskClient } from '../../../packages/client/index.ts';

export { ApiError };

const client = new TaskClient({ baseUrl: '', actor: 'web-user' });

export const api = {
  snapshot: () => client.snapshot(), projects: () => client.listProjects(),
  createProject: (input: { name: string; prefix?: string; workspacePath?: string | null }) => client.createProject(input),
  updateProject: (project: Project, input: Partial<Pick<Project, 'name' | 'workspacePath' | 'labels' | 'readme'>>) => client.updateProject(project.id, { ...input, version: project.version }),
  deleteProject: (project: Project) => client.deleteProject(project.id, project.version),
  tasks: (filters: { projectId?: string; search?: string; status?: string; archived?: boolean | 'all' } = {}) => client.listTasks(filters),
  detail: (taskId: string) => client.getTask(taskId), createTask: (input: TaskInput) => client.createTask(input),
  updateTask: (task: Task, input: Partial<TaskPatch>) => client.updateTask(task.id, { ...input, version: task.version }), deleteTask: (task: Task) => client.deleteTask(task.id, task.version),
  addComment: (task: Task, body: string) => client.addComment(task.id, body), updateComment: (comment: Comment, body: string) => client.updateComment(comment.id, body, comment.version), deleteComment: (comment: Comment) => client.deleteComment(comment.id, comment.version),
  uploadAttachment: (task: Task, file: File, commentId?: string) => client.uploadAttachment(task.id, file, file.name, commentId), attachmentUrl: (attachment: Attachment) => client.attachmentUrl(attachment.id), deleteAttachment: (attachment: Attachment) => client.deleteAttachment(attachment.id),
  addRelation: (task: Task, targetId: string, type: Relation['type']) => client.addRelation(task.id, targetId, type, task.version), removeRelation: (task: Task, relation: Relation) => client.removeRelation(relation.id, task.id, task.version),
  addSession: (task: Task, input: Omit<Session, 'id'>) => client.addSession(task.id, { ...input, version: task.version }), removeSession: (task: Task, session: Session) => client.removeSession(task.id, session.sessionId, task.version),
};
