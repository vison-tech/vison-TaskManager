import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTaskManagerApp } from '../server/app.ts';
import { withWebAssets } from '../server/web.ts';

/** Offline release check: the real database and HTTP handlers, without listening or host access. */
const directory = mkdtempSync(join(tmpdir(), 'taskmanager-package-check-'));
const open = () => createTaskManagerApp({
  dataDir: directory, accessToken: '', agentCommands: [], agentModels: [], agentCommandArguments: [],
});
let runtime: ReturnType<typeof open> | undefined;
try {
  const sqlite = new DatabaseSync(':memory:');
  assert.equal((sqlite.prepare('SELECT 1 AS value').get() as { value: number }).value, 1);
  sqlite.close();
  runtime = open();
  const app = withWebAssets(runtime.app);
  const home = await app.request('http://127.0.0.1/');
  assert.equal(home.status, 200, 'packaged Web must load from relocated app assets');
  const html = await home.text();
  const asset = html.match(/(?:src|href)="(\.\/assets\/[^"\s]+\.js)"/)?.[1];
  assert.ok(asset, 'built page must reference a local script');
  const script = await app.request(new URL(asset, 'http://127.0.0.1/'));
  assert.equal(script.status, 200);
  await script.arrayBuffer();
  const created = await app.request('/api/v1/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Package verification', prefix: 'CHECK' }),
  });
  assert.equal(created.status, 201);
  runtime.close();
  runtime = open();
  const response = await runtime.app.request('/api/v1/projects');
  const body = await response.json() as { items: Array<{ prefix: string }> };
  assert.ok(body.items.some((item) => item.prefix === 'CHECK'), 'SQLite data survives service reopen');
  console.log(JSON.stringify({ ok: true, node: process.version, architecture: process.arch, sqlite: true, web: true, persistence: true }));
} finally {
  runtime?.close();
  rmSync(directory, { recursive: true, force: true });
}
