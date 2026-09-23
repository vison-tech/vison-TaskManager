import type { Hono } from 'hono';
import { routeId } from '../context.ts';
import { fail } from '../validation.ts';
import { JiraAdapter, JiraError } from '../integrations/jira.ts';

function jiraError(error: unknown): never { if (error instanceof JiraError) fail(error.status, error.code, error.message); throw error; }

export function registerJiraRoutes(app: Hono, jira: JiraAdapter): void {
  app.get('/api/v1/integrations/jira/capabilities', (c) => c.json(jira.capabilities()));
  app.post('/api/v1/integrations/jira/test', async (c) => { try { return c.json({ item: await jira.testConnection() }); } catch (error) { return jiraError(error); } });
  app.get('/api/v1/integrations/jira/issues/:key', async (c) => { try { return c.json({ item: await jira.getIssue(routeId(c.req.param('key'))) }); } catch (error) { return jiraError(error); } });
}
