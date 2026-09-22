import type { Task, TaskInput, TaskPatch } from '../../../../packages/contracts/index.ts';
import { client } from './client';

export const taskApi = {
  tasks: (filters: { projectId?: string; search?: string; status?: string; archived?: boolean | 'all' } = {}) => client.listTasks(filters),
  detail: (taskId: string) => client.getTask(taskId),
  createTask: (input: TaskInput) => client.createTask(input),
  updateTask: (task: Task, input: Partial<TaskPatch>) => client.updateTask(task.id, { ...input, version: task.version }),
  deleteTask: (task: Task) => client.deleteTask(task.id, task.version),
};
