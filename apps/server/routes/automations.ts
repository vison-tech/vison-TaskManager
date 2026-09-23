import type { Hono } from 'hono';
import { body, routeId } from '../context.ts';
import { automationCreate, automationPatch, fail } from '../validation.ts';
import type { AutomationScheduler } from '../automation.ts';
import type { Storage } from '../storage.ts';

export function registerAutomationRoutes(app: Hono, storage: Storage, scheduler: AutomationScheduler): void {
  app.get('/api/v1/automations/capabilities', (c) => c.json(scheduler.capabilities()));
  app.get('/api/v1/automations', (c) => c.json({ items: storage.listAutomations(c.req.query('projectId')) }));
  app.post('/api/v1/automations', async (c) => { const input = await body(c, automationCreate); return c.json({ item: storage.write(() => storage.createAutomation(input), { resource: 'project', resourceId: input.projectId }) }, 201); });
  app.get('/api/v1/automations/:id', (c) => c.json({ item: storage.getAutomation(routeId(c.req.param('id'))) }));
  app.patch('/api/v1/automations/:id', async (c) => { const id = routeId(c.req.param('id')); const input = await body(c, automationPatch); return c.json({ item: storage.write(() => storage.updateAutomation(id, input), { resource: 'project', resourceId: id }) }); });
  app.delete('/api/v1/automations/:id', (c) => { const id = routeId(c.req.param('id')); const version = Number(c.req.query('version')); if (!Number.isInteger(version) || version < 1) fail(422, 'VALIDATION_ERROR', 'version query parameter is required'); storage.write(() => storage.deleteAutomation(id, version), { resource: 'project', resourceId: id }); return c.body(null, 204); });
  app.get('/api/v1/automations/:id/runs', (c) => c.json({ items: storage.listAutomationRuns(routeId(c.req.param('id'))) }));
  app.post('/api/v1/automations/:id/run', async (c) => {
    const id = routeId(c.req.param('id')); const current = storage.getAutomation(id); if (!current.enabled) fail(409, 'AUTOMATION_PAUSED', 'Paused automations cannot be triggered');
    storage.write(() => storage.updateAutomation(id, { version: current.version, nextRunAt: new Date().toISOString() }), { resource: 'project', resourceId: id });
    await scheduler.tick();
    return c.json({ item: storage.listAutomationRuns(id)[0] ?? null }, 201);
  });
}
