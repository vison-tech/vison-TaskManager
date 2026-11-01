import { execFile } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build as buildWeb } from 'vite';
import { bundleApplication } from './bundle.ts';
import { collectThirdPartyNotices } from './licenses.ts';
import { hashRuntime } from './runtime.ts';
import { prepareWindowsRuntime } from './windows-runtime.ts';
import { assertWindowsPackageContents, verifyWindowsPackage } from './windows-verify.ts';
import { windowsCommand, windowsIcon, windowsReadme } from './windows-assets.ts';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

async function main(): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build Windows x64 packages on Windows x64.');
  const defaults = JSON.parse(await readFile(join(root, 'scripts/package/windows.config.json'), 'utf8')) as {
    nodeDirectory: string; innoCompiler: string;
  };
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; const value = argv[index + 1];
    if (!['--node', '--node-license', '--iscc', '--output'].includes(name) || !value || value.startsWith('--') || args.has(name)) {
      throw new Error('Usage: npm run package:win -- [--node <node.exe>] [--node-license <LICENSE>] [--iscc <ISCC.exe>] [--output <new directory>]');
    }
    args.set(name, value);
  }
  const node = resolve(args.get('--node') ?? join(defaults.nodeDirectory, 'node.exe'));
  const license = resolve(args.get('--node-license') ?? join(defaults.nodeDirectory, 'LICENSE'));
  if (args.has('--node') && !args.has('--node-license')) throw new Error('Provide the matching --node-license for a custom --node runtime.');
  const compiler = resolve(args.get('--iscc') ?? defaults.innoCompiler);
  for (const required of [node, license, compiler]) {
    try { await access(required); }
    catch { throw new Error(`Missing build tool: ${required}. Run powershell -ExecutionPolicy Bypass -File scripts/package/setup-windows-tools.ps1 first.`); }
  }
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Windows releases require a numeric major.minor.patch version.');
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const output = resolve(args.get('--output') ?? join(root, 'dist/windows', `TaskManager-${metadata.version}-x64-${stamp}`));
  try { await access(output); throw new Error(`Output already exists: ${output}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), '.taskmanager-win-'));
  const payload = join(stage, 'TaskManager');
  let published = false;
  try {
    console.log('Checking Windows Node runtime and SQLite…');
    const runtime = await prepareWindowsRuntime(node, license, join(payload, 'runtime/node.exe'));
    const licenses = join(payload, 'licenses');
    await mkdir(licenses, { recursive: true });
    await copyFile(license, join(licenses, 'Node-LICENSE'));
    await copyFile(join(root, 'LICENSE'), join(licenses, 'TaskManager-LICENSE'));
    console.log('Building Web assets and self-contained application bundles…');
    await buildWeb({ configFile: join(root, 'apps/web/vite.config.ts') });
    const inputs = await bundleApplication(root, join(payload, 'app'), 'win32');
    await cp(join(root, 'dist/web'), join(payload, 'app/dist/web'), { recursive: true });
    const notices = await collectThirdPartyNotices({ root, destination: join(licenses, 'Third-Party-Notices.txt'), requiredInputs: inputs });
    await writeFile(join(payload, 'TaskManager.cmd'), windowsCommand);
    await writeFile(join(payload, 'TaskManager.ico'), windowsIcon());
    await writeFile(join(payload, '使用说明.txt'), `\uFEFF${windowsReadme}`);
    await copyFile(join(root, 'docs/user-guide.md'), join(payload, 'user-guide.md'));
    const info = { version: metadata.version, platform: 'win32', architecture: 'x64', node: runtime,
      nodeLicenseSha256: await hashRuntime(license), thirdPartyPackages: notices.packages,
      signed: false, mode: 'web', builtAt: new Date().toISOString() };
    await writeFile(join(payload, 'app/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
    await assertWindowsPackageContents(payload);
    console.log('Verifying relocated package, persistence and real HTTP start/stop without system Node…');
    const checks = await verifyWindowsPackage(payload, stage);
    await writeFile(join(stage, 'verification.json'), `${JSON.stringify({ ...info, checks }, null, 2)}\n`);
    console.log('Compiling Windows installer…');
    const { stdout } = await execute(compiler, [`/DStageDir=${payload}`, `/DReleaseDir=${stage}`, `/DAppVersion=${metadata.version}`,
      join(root, 'scripts/package/windows.iss')], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    console.log(stdout.trim());
    const name = `TaskManager-${metadata.version}-windows-x64-setup.exe`;
    await writeFile(join(stage, 'SHA256SUMS.txt'), `${await hashRuntime(join(stage, name))}  ${name}\n`);
    await rename(stage, output);
    published = true;
    console.log(`Windows 安装包：${join(output, name)}\n验证报告：${join(output, 'verification.json')}`);
  } finally { if (!published) await rm(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Windows packaging failed.');
  process.exitCode = 1;
});
