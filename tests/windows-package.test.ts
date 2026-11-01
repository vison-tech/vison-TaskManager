import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { spawnOwnedChild } from '../apps/desktop/children.ts';
import { assertWindowsPackageContents } from '../scripts/package/windows-verify.ts';

test('owned child shuts down gracefully and flushes state on Windows IPC disconnect', { skip: process.platform !== 'win32' }, async () => {
  const scratch = join(process.cwd(), 'dist/test-fixtures');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'owned-child-'));
  const marker = join(directory, 'closed.txt');
  const source = `const {writeFileSync}=require('node:fs');
    process.on('disconnect',()=>{writeFileSync(${JSON.stringify(marker)},'graceful');});
    process.send({type:'taskmanager:ready',instanceId:'test-instance',role:'server',port:47830});`;
  const child = spawnOwnedChild({ role: 'server', instanceId: 'test-instance', port: 47830,
    command: { file: process.execPath, args: ['--eval', source] }, cwd: directory, env: process.env, log() {} });
  try {
    await child.waitReady(10_000, new AbortController().signal);
    const result = await child.stop(5000);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(await readFile(marker, 'utf8'), 'graceful');
  } finally {
    await child.stop(1000);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const file of ['app/.env.production', 'app/dist/web/private.sqlite', 'app/dist/web/assets/source.js.map']) {
  test(`release rejects developer files: ${file}`, async () => {
    const scratch = join(process.cwd(), 'dist/test-fixtures');
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, 'contents-'));
    try {
      const path = join(directory, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'must not ship');
      await assert.rejects(assertWindowsPackageContents(directory), /Unexpected release file/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
