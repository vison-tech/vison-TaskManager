import { execFile } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build as buildWeb } from 'vite';
import { bundleApplication } from './bundle.ts';
import { collectThirdPartyNotices } from './licenses.ts';
import { compileNativeLauncher, minimumMacOS, sealLocalApplication, signLocalExecutables } from './macos.ts';
import { hashRuntime, prepareNodeRuntime } from './runtime.ts';
import { assertPackageContents, verifyRelocatedApplication } from './verify.ts';

const execute = promisify(execFile);
export interface PackageOptions { node: string; licensePath: string; arch: 'arm64' | 'x64'; output?: string; runtimeLabel?: string }

export function parsePackageArgs(argv: string[]): PackageOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!['--node', '--node-license', '--arch', '--output', '--runtime-label'].includes(name) || !value || value.startsWith('--') || args.has(name)) {
      throw new Error('Usage: npm run package:mac -- --node-license <exact Node LICENSE> [--node <binary>] [--arch arm64|x64] [--output <new directory>]');
    }
    args.set(name, value);
  }
  const licensePath = args.get('--node-license');
  if (!licensePath) throw new Error('Provide --node-license with the complete LICENSE from the same version as the bundled Node binary.');
  const arch = args.get('--arch') ?? process.arch;
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('Supported macOS package architectures: arm64, x64.');
  const runtimeLabel = args.get('--runtime-label');
  if (runtimeLabel && (runtimeLabel.length > 160 || /[\r\n\x00-\x1f]/.test(runtimeLabel))) throw new Error('Runtime label must be a short single-line description.');
  return { node: resolve(args.get('--node') ?? process.execPath), licensePath: resolve(licensePath), arch,
    ...(runtimeLabel ? { runtimeLabel } : {}),
    ...(args.has('--output') ? { output: resolve(args.get('--output')!) } : {}) };
}

const userReadme = `TaskManaer-Vison macOS 本地试用包

1. 将 TaskManaer-Vison.app 拖到“应用程序”目录后双击打开。
2. 新用户可直接启动，数据默认保存在“用户资源库/Application Support/TaskManager/data”。
3. 已有用户先停止旧注入器、再停止旧服务，在窗口中选择原数据库所在目录。
   应用不会复制或自动迁移旧数据。此前配置存在时会显示原配置。
4. 选择“Codex 内使用”或“浏览器使用”，点“启动”；可在同一窗口停止、打开看板和查看日志。
5. 更新前退出 TaskManaer-Vison，再替换应用；数据、配置和日志放在应用外。
   卸载只删除应用即可保留数据。要删除数据时先自行备份，再处理窗口显示的数据目录。

已内置 Node 和 SQLite，无需安装 Node、npm 或下载依赖。
本包仅有本地 ad-hoc 签名，尚无 Apple 开发者签名/公证；不承诺通过其他电脑的 Gatekeeper 分发检查。
macOS 14+；架构见 verification.json。Codex 应用及可选的 AI 命令行工具仍需另外安装。
内置验证检查资源加载和 SQLite 持久化，未自动运行真实 Codex 或验证干净机器安装。
`;

export async function buildMacApplication(options: PackageOptions): Promise<{ app: string; archive: string; report: string }> {
  if (process.platform !== 'darwin') throw new Error('Build this macOS application on macOS with Xcode Command Line Tools.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  try { await access(options.licensePath); }
  catch { throw new Error(`Missing exact Node LICENSE: ${options.licensePath}. Supply it with --node-license before packaging.`); }
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const output = options.output ?? join(root, 'dist/macos', `TaskManaer-Vison-${metadata.version}-${options.arch}-${stamp}`);
  try { await access(output); throw new Error(`Output already exists: ${output}. Choose a new --output directory.`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), '.taskmanager-package-'));
  const app = join(stage, 'TaskManaer-Vison.app');
  const resources = join(app, 'Contents/Resources');
  const appRoot = join(resources, 'app');
  const licenses = join(resources, 'licenses');
  let published = false;
  try {
    await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(licenses, { recursive: true });
    console.log('Checking and embedding the Node runtime…');
    const runtime = await prepareNodeRuntime({ source: options.node, licensePath: options.licensePath,
      destination: join(resources, 'node'), arch: options.arch });
    await copyFile(options.licensePath, join(licenses, 'Node-LICENSE'));
    await writeFile(join(licenses, 'Runtime-Origin.txt'), `Provided local Node distribution: ${options.runtimeLabel ?? runtime.version}\nBinary version: ${runtime.version}\nThe complete accompanying Node-LICENSE is included. Build/source hashes are recorded in app/build-info.json.\n`);
    await copyFile(join(root, 'LICENSE'), join(licenses, 'TaskManager-LICENSE'));
    console.log('Building application code and Web assets…');
    await buildWeb({ configFile: join(root, 'apps/web/vite.config.ts') });
    const inputs = await bundleApplication(root, appRoot);
    await cp(join(root, 'dist/web'), join(appRoot, 'dist/web'), { recursive: true });
    const notices = await collectThirdPartyNotices({ root, destination: join(licenses, 'Third-Party-Notices.txt'), requiredInputs: inputs });
    console.log('Compiling the native launcher…');
    await compileNativeLauncher(root, app, metadata.version, options.arch, join(root, 'dist/package-cache/swift'));
    await signLocalExecutables(app);
    const info = { version: metadata.version, architecture: options.arch, minimumMacOS,
      node: { ...runtime, distribution: options.runtimeLabel ?? runtime.version, sha256: await hashRuntime(join(resources, 'node')), licenseSha256: await hashRuntime(options.licensePath) },
      signature: 'ad-hoc', notarized: false, thirdPartyPackages: notices.packages, builtAt: new Date().toISOString() };
    await writeFile(join(appRoot, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
    await assertPackageContents(app);
    await sealLocalApplication(app);
    console.log('Verifying a relocated copy with no system Node on PATH…');
    const check = await verifyRelocatedApplication(app);
    await writeFile(join(stage, 'verification.json'), `${JSON.stringify({ ...info, checks: check }, null, 2)}\n`);
    await writeFile(join(stage, '使用说明.txt'), userReadme);
    await copyFile(join(root, 'docs/user-guide.md'), join(stage, 'user-guide.md'));
    const archiveName = `TaskManaer-Vison-${metadata.version}-${options.arch}.zip`;
    await execute('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, join(stage, archiveName)], { timeout: 180_000 });
    await execute('/usr/bin/zip', ['-j', join(stage, archiveName), join(stage, 'user-guide.md')], { timeout: 30_000 });
    await writeFile(join(stage, 'SHA256SUMS.txt'), `${await hashRuntime(join(stage, archiveName))}  ${archiveName}\n`);
    // Only publish after checks pass. Never replace an older distribution or its data.
    await rename(stage, output);
    published = true;
    return { app: join(output, 'TaskManaer-Vison.app'), archive: join(output, archiveName), report: join(output, 'verification.json') };
  } finally { if (!published) await rm(stage, { recursive: true, force: true }); }
}
