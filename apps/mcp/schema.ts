import { z } from 'zod';
import { date as calendarDate, developmentContext, priorities, recurrence, statuses } from '../../packages/contracts/index.ts';

export { developmentContext, recurrence };

export const status = z.enum(statuses);
export const priority = z.enum(priorities);
export const date = calendarDate;

export function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
