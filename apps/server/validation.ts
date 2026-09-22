import { z } from 'zod';
import { priorities, statuses } from '../../packages/contracts/index.ts';

export class DomainError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); this.name = 'DomainError'; } }
export function fail(status: number, code: string, message: string, details?: unknown): never { throw new DomainError(status, code, message, details); }
const text = z.string().trim().min(1).max(500);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }, 'Invalid calendar date');
const labels = z.array(z.string().trim().min(1).max(100)).max(100).transform((values) => [...new Set(values)]);
export const version = z.number().int().positive();
export const projectCreate = z.object({ name: text, prefix: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{0,11}$/).transform((value) => value.toUpperCase()).optional(), workspacePath: z.string().max(4096).nullable().optional(), labels: labels.optional(), readme: z.string().max(1_000_000).optional() }).strict();
export const projectPatch = z.object({ version, name: text.optional(), workspacePath: z.string().max(4096).nullable().optional(), labels: labels.optional(), readme: z.string().max(1_000_000).optional() }).strict();
const recurrence = z.object({ interval: z.number().int().min(1).max(1000), unit: z.enum(['day', 'week', 'month', 'year']) }).strict();
const developmentContext = z.object({ type: z.enum(['branch', 'worktree']), branch: z.string().max(4096).optional(), path: z.string().max(4096).optional() }).strict();
export const taskCreate = z.object({ projectId: text, title: text, description: z.string().max(1_000_000).default(''), status: z.enum(statuses).default('todo'), priority: z.enum(priorities).default('none'), labels: labels.default([]), assignee: z.string().max(500).default(''), sortOrder: z.number().finite().optional(), startDate: date.nullable().default(null), dueDate: date.nullable().default(null), recurrence: recurrence.nullable().default(null), developmentContext: developmentContext.nullable().default(null), archivedAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict();
export const taskPatch = z.object({ version, projectId: text.optional(), title: text.optional(), description: z.string().max(1_000_000).optional(), status: z.enum(statuses).optional(), priority: z.enum(priorities).optional(), labels: labels.optional(), assignee: z.string().max(500).optional(), sortOrder: z.number().finite().optional(), startDate: date.nullable().optional(), dueDate: date.nullable().optional(), recurrence: recurrence.nullable().optional(), developmentContext: developmentContext.nullable().optional(), archivedAt: z.string().datetime({ offset: true }).nullable().optional() }).strict();
export const commentCreate = z.object({ body: z.string().trim().min(1).max(1_000_000) }).strict();
export const commentPatch = commentCreate.extend({ version }).strict();
export const relationCreate = z.object({ targetId: text, type: z.enum(['parent', 'blocks', 'related']), version }).strict();
export const sessionCreate = z.object({ platform: z.enum(['codex', 'claude', 'pi', 'agy', 'grok']), sessionId: text, projectId: text.optional(), hostId: text.optional(), workspacePath: z.string().max(4096).optional(), projectKind: z.enum(['local', 'remote']).optional(), version }).strict();
export function validateTask(task: { recurrence: unknown; dueDate: string | null; startDate: string | null }) { if (task.recurrence && !task.dueDate) fail(422, 'VALIDATION_ERROR', 'Recurring tasks require a dueDate'); if (task.startDate && task.dueDate && task.startDate > task.dueDate) fail(422, 'VALIDATION_ERROR', 'startDate must not be after dueDate'); }
