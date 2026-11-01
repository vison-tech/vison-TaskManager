import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { hashRuntime, validateNodeLicense, type PreparedNodeRuntime } from './runtime.ts';

const execute = promisify(execFile);

export function windowsRuntimeEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_|TSX_|TASKMANAGER_|DYLD_|LD_)|^(?:PATH|PORT|HOST)$/i.test(key)) delete env[key];
  }
  env.PATH = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  return env;
}

export async function prepareWindowsRuntime(source: string, licensePath: string, destination: string): Promise<PreparedNodeRuntime> {
  validateNodeLicense(await readFile(licensePath, 'utf8'));
  const bytes = await readFile(source);
  const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : 0;
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || offset + 6 > bytes.length
    || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0' || bytes.readUInt16LE(offset + 4) !== 0x8664) {
    throw new Error('Provide the official Windows x64 Node executable.');
  }
  const probe = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:');
    if(db.prepare('SELECT 1 AS n').get().n!==1)process.exit(1);db.close();
    console.log(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}));`;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const { stdout } = await execute(destination, ['--eval', probe], { env: windowsRuntimeEnvironment(), timeout: 15_000 });
  const identity = JSON.parse(stdout.trim()) as { version: string; platform: string; arch: string };
  if (identity.platform !== 'win32' || identity.arch !== 'x64' || !/^v24\./.test(identity.version)) {
    throw new Error('Windows packaging requires Node 24 LTS x64 with built-in SQLite.');
  }
  return { version: identity.version, architecture: 'x64', sourceSha256: await hashRuntime(source), sha256: await hashRuntime(destination) };
}
