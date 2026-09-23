import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError } from './validation.ts';
import { Storage } from './storage.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerCollaborationRoutes } from './routes/collaboration.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerTaskRoutes } from './routes/tasks.ts';
import { AgentRuntime, type PermissionMode } from '../../packages/agent-runtime/index.ts';
import { registerAgentRoutes } from './routes/agent.ts';
import { AutomationScheduler } from './automation.ts';
import { registerAutomationRoutes } from './routes/automations.ts';
import { JiraAdapter, type JiraAdapterOptions } from './integrations/jira.ts';
import { registerJiraRoutes } from './routes/jira.ts';

export interface TaskManagerApp { app: Hono; storage: Storage; agentRuntime: AgentRuntime; automationScheduler: AutomationScheduler; jira: JiraAdapter; close: () => void; }

export interface TaskManagerAppOptions { dataDir?: string; accessToken?: string; allowedOrigins?: string[]; agentCommands?: string[]; agentModels?: string[]; agentSkillDirectories?: string[]; agentPermissionModes?: PermissionMode[]; jira?: JiraAdapterOptions; }

type WebSession = { csrfToken: string; createdAt: number };
const sessionCookie = 'taskmanager_session';
const csrfHeader = 'X-TaskManager-CSRF';
const sessionTtlMs = 86_400_000;

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}

export function createTaskManagerApp(options: TaskManagerAppOptions = {}): TaskManagerApp {
  const storage = new Storage(options.dataDir ?? process.env.TASKMANAGER_DATA_DIR ?? join(process.cwd(), '.data'));
  const agentRuntime = new AgentRuntime({ allowedCommands: options.agentCommands ?? (process.env.TASKMANAGER_AGENT_COMMANDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []), allowedModels: options.agentModels ?? (process.env.TASKMANAGER_AGENT_MODELS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []), skillDirectories: options.agentSkillDirectories ?? (process.env.TASKMANAGER_AGENT_SKILL_DIRS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []), permissionModes: options.agentPermissionModes ?? (process.env.TASKMANAGER_AGENT_PERMISSION_MODES?.split(',').map((value) => value.trim()).filter((value): value is PermissionMode => ['read', 'write', 'full'].includes(value)) ?? []), persistence: storage.agentRuntimePersistence() });
  const automationScheduler = new AutomationScheduler(storage, agentRuntime);
  const jira = new JiraAdapter(options.jira);
  const app = new Hono();
  const sessions = new Map<string, WebSession>();
  const accessToken = options.accessToken ?? process.env.TASKMANAGER_ACCESS_TOKEN;
  const allowedOrigins = options.allowedOrigins ?? (process.env.TASKMANAGER_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []);
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) return c.json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Only configured local origins may access this instance', requestId: randomUUID() } }, 403);
    if (c.req.method === 'OPTIONS') return next();
    const bearer = accessToken && c.req.header('Authorization') === `Bearer ${accessToken}`;
    const sessionId = getCookie(c, sessionCookie);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && session && Date.now() - session.createdAt >= sessionTtlMs) sessions.delete(sessionId);
    const liveSession = session && Date.now() - session.createdAt < sessionTtlMs ? session : undefined;
    const isSessionBootstrap = c.req.method === 'POST' && c.req.path === '/api/v1/session';
    if (accessToken && !bearer && !liveSession && !isSessionBootstrap) return c.json({ error: { code: 'UNAUTHORIZED', message: 'A valid instance token or web session is required', requestId: randomUUID() } }, 401);
    if (isSessionBootstrap && accessToken && !bearer && !origin) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Session bootstrap requires a trusted browser origin', requestId: randomUUID() } }, 401);
    if (liveSession && !bearer && !isSessionBootstrap && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      const token = c.req.header(csrfHeader);
      if (!token || token !== liveSession.csrfToken) return c.json({ error: { code: 'CSRF_TOKEN_REQUIRED', message: 'A valid CSRF token is required for web writes', requestId: randomUUID() } }, 403);
    }
    await next();
  });
  app.use('*', cors({ origin: (origin) => origin && isAllowedOrigin(origin, allowedOrigins) ? origin : 'http://127.0.0.1', credentials: true }));
  app.onError((error, c) => {
    const known = error instanceof DomainError;
    const status = known ? error.status : 500;
    if (!known) console.error(error);
    return c.json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Unexpected server error', ...(known && error.details ? { details: error.details } : {}), requestId: randomUUID() } }, status as ContentfulStatusCode);
  });

  app.post('/api/v1/session', (c) => {
    const existingId = getCookie(c, sessionCookie);
    const existing = existingId ? sessions.get(existingId) : undefined;
    const id = existingId && existing ? existingId : randomUUID();
    const csrfToken = existing && Date.now() - existing.createdAt < sessionTtlMs ? existing.csrfToken : randomUUID();
    sessions.set(id, { csrfToken, createdAt: Date.now() });
    while (sessions.size > 1000) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
      if (!oldest) break;
      sessions.delete(oldest);
    }
    setCookie(c, sessionCookie, id, { httpOnly: true, sameSite: 'Strict', secure: false, path: '/', maxAge: sessionTtlMs / 1000 });
    return c.json({ item: { csrfToken, expiresIn: sessionTtlMs / 1000 } });
  });

  registerMetaRoutes(app, storage);
  registerProjectRoutes(app, storage);
  registerTaskRoutes(app, storage);
  registerCollaborationRoutes(app, storage);
  registerAttachmentRoutes(app, storage);
  registerEventRoutes(app, storage);
  registerAgentRoutes(app, agentRuntime);
  registerAutomationRoutes(app, storage, automationScheduler);
  registerJiraRoutes(app, jira);

  return { app, storage, agentRuntime, automationScheduler, jira, close: () => { sessions.clear(); automationScheduler.close(); agentRuntime.shutdown(); storage.close(); } };
}
