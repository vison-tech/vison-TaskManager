import { z } from 'zod';
import { priorities, projectKinds, relationTypes, statuses, platforms } from './values.ts';

const text = z.string().trim().min(1).max(500);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const labels = z.array(z.string().trim().min(1).max(100)).max(100).transform((values) => [...new Set(values)]);
export const version = z.number().int().positive();
export const actor = z.object({ type: z.enum(['user', 'agent', 'system']), id: text, name: z.string().max(200).optional(), avatar: z.string().max(4096).optional() }).strict();
export const sessionRef = z.object({ platform: z.enum(platforms), sessionId: text, projectId: text.optional(), hostId: text.optional(), workspacePath: z.string().max(4096).optional(), projectKind: z.enum(projectKinds).optional() }).strict();
export const attachmentOwner = z.object({ type: z.enum(['task', 'comment', 'project']), id: text }).strict();
export const recurrence = z.object({ interval: z.number().int().min(1).max(1000), unit: z.enum(['day', 'week', 'month', 'year']), anchorDate: date.optional(), occurrence: z.number().int().nonnegative().max(100000).optional() }).strict();
export const developmentContext = z.object({ type: z.enum(['branch', 'worktree']), branch: z.string().max(4096).optional(), path: z.string().max(4096).optional() }).strict();

export const projectCreate = z.object({ name: text, prefix: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{0,11}$/).transform((value) => value.toUpperCase()).optional(), workspacePath: z.string().max(4096).nullable().optional(), labels: labels.optional(), readme: z.string().max(1_000_000).optional() }).strict();
export const projectPatch = z.object({ version, name: text.optional(), workspacePath: z.string().max(4096).nullable().optional(), labels: labels.optional(), readme: z.string().max(1_000_000).optional() }).strict();
export const taskCreate = z.object({ projectId: text, title: text, description: z.string().max(1_000_000).default(''), status: z.enum(statuses).default('todo'), priority: z.enum(priorities).default('none'), labels: labels.default([]), assignee: z.string().max(500).default(''), sortOrder: z.number().finite().optional(), startDate: date.nullable().default(null), dueDate: date.nullable().default(null), recurrence: recurrence.nullable().default(null), developmentContext: developmentContext.nullable().default(null), archivedAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict();
export const taskPatch = z.object({ version, projectId: text.optional(), title: text.optional(), description: z.string().max(1_000_000).optional(), status: z.enum(statuses).optional(), priority: z.enum(priorities).optional(), labels: labels.optional(), assignee: z.string().max(500).optional(), sortOrder: z.number().finite().optional(), startDate: date.nullable().optional(), dueDate: date.nullable().optional(), recurrence: recurrence.nullable().optional(), developmentContext: developmentContext.nullable().optional(), archivedAt: z.string().datetime({ offset: true }).nullable().optional() }).strict();
export const taskCopy = z.object({ version, projectId: text.optional(), title: text.optional() }).strict();
export const taskComplete = z.object({ version }).strict();
export const commentCreate = z.object({ body: z.string().trim().min(1).max(1_000_000) }).strict();
export const commentPatch = commentCreate.extend({ version }).strict();
export const relationCreate = z.object({ targetId: text, type: z.enum(relationTypes), version }).strict();
export const sessionCreate = sessionRef.extend({ version }).strict();
export const agentRunCreate = z.object({ sessionId: text, command: text, args: z.array(z.string().max(4096)).max(100).default([]), cwd: z.string().max(4096).optional(), model: z.string().max(200).optional(), permissionMode: z.enum(['read', 'write', 'full']).default('read'), skillIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]), input: z.string().max(1_000_000).optional() }).strict();
export const agentRunContinue = z.object({ input: z.string().max(1_000_000).optional() }).strict();
export const automationCreate = z.object({ projectId: text, name: text, enabled: z.boolean().default(true), intervalSeconds: z.number().int().min(1).max(604800), command: text, sessionId: text, input: z.string().max(1_000_000).default(''), model: z.string().max(200).optional(), permissionMode: z.enum(['read', 'write', 'full']).default('read'), skillIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]), nextRunAt: z.string().datetime({ offset: true }).optional() }).strict();
export const automationPatch = z.object({ version, name: text.optional(), enabled: z.boolean().optional(), intervalSeconds: z.number().int().min(1).max(604800).optional(), command: text.optional(), sessionId: text.optional(), input: z.string().max(1_000_000).optional(), model: z.string().max(200).nullable().optional(), permissionMode: z.enum(['read', 'write', 'full']).optional(), skillIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(), nextRunAt: z.string().datetime({ offset: true }).optional() }).strict();

export const apiError = z.object({ error: z.object({ code: z.string().min(1), message: z.string().min(1), details: z.unknown().optional(), requestId: z.string().uuid() }).strict() }).strict();
export const revisionEvent = z.object({ protocolVersion: z.literal('1'), type: z.literal('revision'), revision: z.number().int().nonnegative(), resource: z.enum(['project', 'task', 'comment', 'attachment', 'relation', 'session', 'readme']).optional(), resourceId: text.optional() }).strict();
export const hostCapability = z.enum(['embedPanel', 'readContext', 'openConversation', 'composeDraft', 'runAgent']);
export const hostCapabilityState = z.enum(['supported', 'unsupported', 'unavailable']);
export const hostCapabilities = z.record(hostCapability, z.object({ state: hostCapabilityState, reason: z.string().max(500).optional() }).strict());
export const hostBridgeMessage = z.object({ protocolVersion: z.literal('1'), requestId: z.string().uuid(), type: z.enum(['hello', 'capabilities', 'context', 'openConversation', 'composeDraft', 'response', 'error']), payload: z.unknown() }).strict();

export type TaskCreateInput = z.infer<typeof taskCreate>;
export type TaskPatchInput = z.infer<typeof taskPatch>;
export type TaskCopyInput = z.infer<typeof taskCopy>;
export type SessionCreateInput = z.infer<typeof sessionCreate>;
export type AutomationCreateInput = z.infer<typeof automationCreate>;
export type AutomationPatchInput = z.infer<typeof automationPatch>;
