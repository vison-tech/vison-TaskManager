import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type RuntimeArch = 'arm64' | 'x64';
interface RuntimeOptions { source: string; licensePath: string; destination: string; arch: RuntimeArch }
export interface PreparedNodeRuntime { version: string; architecture: RuntimeArch; sha256: string; sourceSha256: string }

/** Build checks do not load an ambient Node hook or third-party dynamic library. */
export function cleanRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...environment, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const key of Object.keys(result)) {
    if (/^(?:NODE_|DYLD_|LD_|TSX_)/.test(key)) delete result[key];
  }
  return result;
}

export function validateRuntimeDependencies(output: string): void {
  const dependencies = output.split('\n').filter((line) => /^\s+\S.+\(compatibility version /.test(line));
  if (!dependencies.length) throw new Error('Cannot verify Node dynamic-library dependencies.');
  for (const line of dependencies) {
    const dependency = line.trim().split(' (compatibility version ')[0];
    if (!dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/')) {
      throw new Error(`Node depends on a non-system library: ${dependency}. Use a self-contained Node distribution.`);
    }
  }
}

export function parseRuntimeArchitectures(output: string): string[] {
  const values = output.trim().split(/\s+/);
  if (!values.length || values.some((value) => !['arm64', 'x86_64'].includes(value))) {
    throw new Error('Node must be a supported macOS arm64 or x86_64 Mach-O executable.');
  }
  return [...new Set(values)];
}

export function validateMinimumMacOS(output: string): void {
  const minimum = output.match(/\bminos\s+(\d+)\.(\d+)(?:\.(\d+))?/) ?? output.match(/\bversion\s+(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!minimum) throw new Error('Cannot verify Node minimum macOS version.');
  if (Number(minimum[1]) > 14 || (Number(minimum[1]) === 14 && (Number(minimum[2]) > 0 || Number(minimum[3] ?? 0) > 0))) {
    throw new Error('This release targets macOS 14.0; selected Node requires a newer macOS version.');
  }
}

export function validateNodeLicense(contents: string): void {
  if (contents.length < 10_000 || !contents.includes('Node.js is licensed for use as follows:')
    || !contents.includes('Copyright Node.js contributors.') || !contents.includes('Permission is hereby granted')
    || !contents.includes('externally maintained libraries')) {
    throw new Error('Provide the complete LICENSE from the exact Node distribution, including bundled third-party notices.');
  }
}

export async function hashRuntime(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

const metadataSource = 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})';
async function metadata(source: string): Promise<{ version: string; platform: string; arch: string }> {
  const { stdout } = await execute(source, ['-p', metadataSource], { env: cleanRuntimeEnvironment(), timeout: 15_000 });
  let value: { version: string; platform: string; arch: string };
  try { value = JSON.parse(stdout); } catch { throw new Error('Cannot read Node runtime identity.'); }
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(value.version) || Number(value.version.split('.')[0].slice(1)) < 24
    || value.platform !== 'darwin' || !['arm64', 'x64'].includes(value.arch)) {
    throw new Error('Packaging requires a macOS Node.js 24 or newer runtime.');
  }
  return value;
}

/** Copies only a checked runtime; consumers explicitly copy its matching LICENSE. */
export async function prepareNodeRuntime(options: RuntimeOptions): Promise<PreparedNodeRuntime> {
  if (process.platform !== 'darwin') throw new Error('macOS packaging must run on macOS.');
  if (![options.source, options.licensePath, options.destination].every(isAbsolute)) {
    throw new Error('Runtime, LICENSE and destination paths must be absolute.');
  }
  let license: string;
  try { license = await readFile(options.licensePath, 'utf8'); }
  catch { throw new Error('Node LICENSE is missing. Supply the complete LICENSE from the exact runtime version before packaging.'); }
  validateNodeLicense(license);
  const source = await realpath(options.source);
  if (!(await stat(source)).isFile()) throw new Error('Node source must be an executable file.');
  const original = await metadata(source);
  const { stdout: libraries } = await execute('/usr/bin/otool', ['-L', source], { env: cleanRuntimeEnvironment() });
  validateRuntimeDependencies(libraries);
  const { stdout: architectures } = await execute('/usr/bin/lipo', ['-archs', source], { env: cleanRuntimeEnvironment() });
  const present = parseRuntimeArchitectures(architectures);
  const nativeArch = options.arch === 'x64' ? 'x86_64' : 'arm64';
  if (!present.includes(nativeArch)) throw new Error(`Node does not contain the requested ${options.arch} architecture.`);
  const { stdout: loadCommands } = await execute('/usr/bin/otool', ['-l', '-arch', nativeArch, source], { env: cleanRuntimeEnvironment() });
  validateMinimumMacOS(loadCommands);
  const sourceSha256 = await hashRuntime(source);
  await mkdir(dirname(options.destination), { recursive: true });
  // Never replace an arbitrary existing executable, including the build machine's Node.
  await copyFile(source, options.destination, constants.COPYFILE_EXCL);
  try {
    if (present.length > 1) {
      const thinPath = `${options.destination}.thin-${randomUUID()}`;
      try {
        await execute('/usr/bin/lipo', [options.destination, '-thin', nativeArch, '-output', thinPath], { env: cleanRuntimeEnvironment() });
        await copyFile(thinPath, options.destination);
      } finally { await rm(thinPath, { force: true }); }
    }
    await chmod(options.destination, 0o755);
    const copied = await metadata(options.destination);
    if (copied.arch !== options.arch || copied.version !== original.version) throw new Error('Copied Node runtime identity does not match the selected runtime.');
    const smoke = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(':memory:');
      db.exec("CREATE TABLE smoke(value TEXT); INSERT INTO smoke VALUES ('bundled')");
      if (db.prepare('SELECT value FROM smoke').get().value !== 'bundled') process.exit(1);
      db.close();
      process.stdout.write('sqlite-ready');
    `;
    const { stdout } = await execute(options.destination, ['--eval', smoke], { env: cleanRuntimeEnvironment(), timeout: 15_000 });
    if (stdout !== 'sqlite-ready') throw new Error('Bundled Node SQLite check failed.');
    return { version: copied.version, architecture: options.arch, sha256: await hashRuntime(options.destination), sourceSha256 };
  } catch (error) {
    await rm(options.destination, { force: true });
    throw error;
  }
}
