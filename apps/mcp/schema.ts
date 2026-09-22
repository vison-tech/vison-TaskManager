import { z } from 'zod';
import { priorities, statuses } from '../../packages/contracts/index.ts';

export const status = z.enum(statuses);
export const priority = z.enum(priorities);
export const recurrence = z.object({ interval: z.number().int().min(1).max(1000), unit: z.enum(['day', 'week', 'month', 'year']) });
export const developmentContext = z.object({ type: z.enum(['branch', 'worktree']), branch: z.string().max(4096).optional(), path: z.string().max(4096).optional() });

export function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
