import type { Relation, Session, Task, TaskDetail, TaskInput, TaskPatch } from '../../packages/contracts/index.ts';

export interface McpTaskClient {
  listProjects(): Promise<unknown[]>;
  listTasks(filters: { projectId?: string; status?: string; search?: string; archived?: boolean | 'all' }): Promise<Task[]>;
  getTask(taskId: string): Promise<TaskDetail>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(taskId: string, input: TaskPatch): Promise<Task>;
  completeTask(taskId: string, version: number): Promise<{ task: Task; nextTask: Task | null }>;
  addComment(taskId: string, body: string): Promise<unknown>;
  addRelation(taskId: string, targetId: string, type: Relation['type'], version: number): Promise<unknown>;
  addSession(taskId: string, input: Omit<Session, 'id'> & { version: number }): Promise<Task>;
  tree(taskId: string, direction: 'ancestors' | 'descendants', depth: number): Promise<{ nodes: Task[]; relations: Relation[] }>;
}
