import { fail } from './errors.ts';

export function validateTask(task: { recurrence: unknown; dueDate: string | null; startDate: string | null }) {
  if (task.recurrence && !task.dueDate) fail(422, 'VALIDATION_ERROR', 'Recurring tasks require a dueDate');
  if (task.startDate && task.dueDate && task.startDate > task.dueDate) fail(422, 'VALIDATION_ERROR', 'startDate must not be after dueDate');
}
