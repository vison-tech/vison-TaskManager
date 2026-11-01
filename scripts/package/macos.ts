import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanRuntimeEnvironment } from './runtime.ts';

const execute = promisify(execFile);
export const minimumMacOS = '14.0';

export function appPlist(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('App version must use three numeric components.');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.taskmanager.desktop</string>
<key>CFBundleName</key><string>TaskManaer-Vison</string>
<key>CFBundleDisplayName</key><string>TaskManaer-Vison</string>
<key>CFBundleExecutable</key><string>TaskManager</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>${minimumMacOS}</string>
<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>\n`;
}

export async function compileNativeLauncher(root: string, app: string, version: string, arch: 'arm64' | 'x64', cache: string): Promise<void> {
  const directory = join(root, 'apps/desktop/macos');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.swift')).sort().map((file) => join(directory, file));
  if (!files.length) throw new Error('Native launcher sources are missing.');
  await execute('/usr/bin/xcrun', ['swiftc', '-O', '-module-cache-path', cache,
    '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx${minimumMacOS}`, ...files,
    '-o', join(app, 'Contents/MacOS/TaskManager')], {
    env: cleanRuntimeEnvironment(), timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
  });
  await writeFile(join(app, 'Contents/Info.plist'), appPlist(version));
  await execute('/usr/bin/plutil', ['-lint', join(app, 'Contents/Info.plist')]);
}

export async function signLocalExecutables(app: string): Promise<void> {
  for (const path of [join(app, 'Contents/Resources/node'), join(app, 'Contents/MacOS/TaskManager')]) {
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path], { timeout: 30_000 });
  }
}

export async function sealLocalApplication(app: string): Promise<void> {
  await execute('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', app], { timeout: 30_000 });
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { timeout: 30_000 });
}
