import type { Task } from '../../packages/contracts/index.ts';

type Recurrence = NonNullable<Task['recurrence']>;

function parts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addCalendarPeriod(value: string, recurrence: Recurrence, occurrence?: number): string {
  const [year, month, day] = parts(value);
  const count = recurrence.interval * (occurrence ?? 1);
  if (recurrence.unit === 'day' || recurrence.unit === 'week') {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + count * (recurrence.unit === 'week' ? 7 : 1));
    return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const targetMonth = recurrence.unit === 'year' ? month : month + count;
  const targetYear = recurrence.unit === 'year' ? year + count : year + Math.floor((targetMonth - 1) / 12);
  const normalizedMonth = recurrence.unit === 'year' ? month : ((targetMonth - 1) % 12) + 1;
  return format(targetYear, normalizedMonth, Math.min(day, daysInMonth(targetYear, normalizedMonth)));
}

export function recurrenceNextDates(task: Pick<Task, 'startDate' | 'dueDate' | 'recurrence'>): { startDate: string | null; dueDate: string } | null {
  if (!task.recurrence || !task.dueDate) return null;
  const recurrence = task.recurrence;
  const occurrence = (recurrence.occurrence ?? 0) + 1;
  const anchor = recurrence.anchorDate ?? task.dueDate;
  const dueDate = addCalendarPeriod(anchor, recurrence, occurrence);
  if (!task.startDate) return { startDate: null, dueDate };
  const start = parts(task.startDate);
  const due = parts(task.dueDate);
  const duration = Math.round((Date.UTC(due[0], due[1] - 1, due[2]) - Date.UTC(start[0], start[1] - 1, start[2])) / 86_400_000);
  const dueParts = parts(dueDate);
  const nextStart = new Date(Date.UTC(dueParts[0], dueParts[1] - 1, dueParts[2]));
  nextStart.setUTCDate(nextStart.getUTCDate() - duration);
  return { startDate: format(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, nextStart.getUTCDate()), dueDate };
}

export function nextRecurrenceConfig(recurrence: Recurrence, anchorDate: string, occurrence: number): Recurrence {
  return { ...recurrence, anchorDate: recurrence.anchorDate ?? anchorDate, occurrence };
}
