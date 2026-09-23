import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ManifestFile = { path: string; size: number; sha256: string };
type Manifest = { formatVersion: 1; schemaVersion: number; createdAt: string; files: ManifestFile[] };

function digest(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function collectFiles(root: string, relative = ''): ManifestFile[] {
  const directory = join(root, relative);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) return collectFiles(root, path);
    const absolute = join(root, path);
    return [{ path, size: statSync(absolute).size, sha256: digest(absolute) }];
  });
}
function assertIntegrity(databasePath: string): number {
  const db = new DatabaseSync(databasePath);
  try {
    const check = String((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
    if (check !== 'ok') throw new Error(`SQLite integrity check failed: ${check}`);
    return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  } finally { db.close(); }
}

export function createBackup(dataDir: string, destination: string): Manifest {
  const source = resolve(dataDir);
  const target = resolve(destination);
  const database = join(source, 'taskmanager.sqlite');
  if (!existsSync(database)) throw new Error(`Database not found: ${database}`);
  if (existsSync(target)) throw new Error(`Backup destination already exists: ${target}`);
  const db = new DatabaseSync(database);
  mkdirSync(target, { recursive: true });
  const targetDatabase = join(target, 'taskmanager.sqlite');
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const escaped = targetDatabase.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally { db.close(); }
  const schemaVersion = assertIntegrity(targetDatabase);
  const attachments = join(source, 'attachments');
  if (existsSync(attachments)) cpSync(attachments, join(target, 'attachments'), { recursive: true });
  const manifest: Manifest = { formatVersion: 1, schemaVersion, createdAt: new Date().toISOString(), files: collectFiles(target) };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function restoreBackup(source: string, destination: string, replace = false): Manifest {
  const backup = resolve(source);
  const target = resolve(destination);
  const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported backup manifest');
  if (existsSync(target)) {
    if (!replace) throw new Error(`Restore destination already exists: ${target}`);
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  cpSync(join(backup, 'taskmanager.sqlite'), join(target, 'taskmanager.sqlite'));
  const attachments = join(backup, 'attachments');
  if (existsSync(attachments)) cpSync(attachments, join(target, 'attachments'), { recursive: true });
  const schemaVersion = assertIntegrity(join(target, 'taskmanager.sqlite'));
  if (schemaVersion !== manifest.schemaVersion) throw new Error(`Restored schema version ${schemaVersion} does not match manifest ${manifest.schemaVersion}`);
  for (const file of manifest.files) {
    const restored = join(target, file.path);
    if (!existsSync(restored) || statSync(restored).size !== file.size || digest(restored) !== file.sha256) throw new Error(`Backup verification failed: ${file.path}`);
  }
  return manifest;
}

async function main() {
  const [command, first, second, ...flags] = process.argv.slice(2);
  if (command === 'create' && first) {
    const manifest = createBackup(process.env.TASKMANAGER_DATA_DIR ?? '.data', first);
    console.log(`Backup created: ${basename(resolve(first))} (${manifest.files.length} files)`);
    return;
  }
  if (command === 'restore' && first && second) {
    restoreBackup(first, second, flags.includes('--replace'));
    console.log(`Backup restored to ${resolve(second)}`);
    return;
  }
  console.error('Usage: backup create <directory> | backup restore <directory> <data-dir> [--replace]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
