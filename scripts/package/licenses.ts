import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface LicenseOptions { root: string; destination: string; requiredInputs?: string[] }
interface PackageNotice { path: string; name: string; version: string; declaration: string; texts: Array<{ file: string; text: string }> }

const licenseFile = /^(?:licen[cs]e(?:[._-].*)?|copying(?:[._-].*)?|notice(?:[._-].*)?|copyright(?:[._-].*)?)$/i;
const within = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`);
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

async function safeText(path: string, root: string): Promise<string | undefined> {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) return;
  if (details.size > 5 * 1024 * 1024) throw new Error(`License file is too large: ${relative(root, path)}`);
  if (!within(root, await realpath(path))) throw new Error('License path escapes node_modules.');
  return readFile(path, 'utf8');
}

async function packageNotice(path: string, modules: string): Promise<PackageNotice | undefined> {
  let manifest: Record<string, unknown>;
  try {
    const source = await safeText(join(path, 'package.json'), modules);
    if (!source) return;
    manifest = JSON.parse(source);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return;
  const texts: PackageNotice['texts'] = [];
  const files = await readdir(path, { withFileTypes: true });
  for (const item of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!item.isFile() || !licenseFile.test(item.name)) continue;
    const text = await safeText(join(path, item.name), modules);
    if (text?.trim()) texts.push({ file: item.name, text });
  }
  if (!texts.length) {
    // A README can itself carry the full grant; an SPDX name alone is not a notice.
    for (const item of files.filter((entry) => entry.isFile() && /^readme(?:[._-].*)?$/i.test(entry.name))) {
      const text = await safeText(join(path, item.name), modules);
      const section = text?.match(/^#{1,3}\s+Licen[cs]e\b[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im)?.[0];
      if (section && /copyright/i.test(section) && /permission|redistribution|licensed under|public domain/i.test(section)
        && section.length > 300) texts.push({ file: `${item.name} (license section)`, text: section });
    }
  }
  const license = manifest.license;
  const declaration = typeof license === 'string' ? license
    : license && typeof license === 'object' && 'type' in license && typeof license.type === 'string' ? license.type : 'not declared';
  return { path, name: manifest.name, version: manifest.version, declaration, texts };
}

/** Conservatively preserve installed-package notices, plus enforce coverage for actual bundle inputs. */
export async function collectThirdPartyNotices(options: LicenseOptions): Promise<{ packages: number; declaredOnly: string[] }> {
  const suppliedRoot = resolve(options.root);
  const root = await realpath(suppliedRoot);
  const modules = join(root, 'node_modules');
  const canonical = await realpath(modules);
  if (canonical !== modules) throw new Error('node_modules must be a local directory, not an external symlink.');
  const notices: PackageNotice[] = [];
  const skipped: string[] = [];
  const visitModules = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped.push(relative(root, path)); continue; }
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        for (const scoped of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          const scopedPath = join(path, scoped.name);
          if (scoped.isSymbolicLink()) skipped.push(relative(root, scopedPath));
          else if (scoped.isDirectory()) await visitPackage(scopedPath);
        }
      } else await visitPackage(path);
    }
  };
  const visitPackage = async (path: string): Promise<void> => {
    const notice = await packageNotice(path, modules);
    if (notice) notices.push(notice);
    const nested = join(path, 'node_modules');
    try {
      const details = await lstat(nested);
      if (details.isSymbolicLink()) skipped.push(relative(root, nested));
      else if (details.isDirectory()) await visitModules(nested);
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  };
  await visitModules(modules);
  notices.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  for (const input of options.requiredInputs ?? []) {
    const suppliedPath = isAbsolute(input) ? resolve(input) : resolve(suppliedRoot, input);
    if (!within(suppliedRoot, suppliedPath) && !within(root, suppliedPath)) throw new Error('Bundle input is outside the project license collection root.');
    const path = within(suppliedRoot, suppliedPath) ? resolve(root, relative(suppliedRoot, suppliedPath)) : suppliedPath;
    if (!within(modules, path)) continue;
    const notice = notices.filter((item) => within(item.path, path)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!notice?.texts.length) throw new Error(`Bundled dependency has no complete license notice: ${relative(root, path)}`);
    if (!within(modules, await realpath(path))) throw new Error(`Bundled dependency escapes node_modules: ${relative(root, path)}`);
  }
  const declaredOnly = notices.filter((item) => !item.texts.length).map((item) => `${item.name}@${item.version}`);
  const sections = [
    '# Third-party software notices',
    'This file conservatively includes all installed npm packages. Some development-only packages are not shipped as executable code.',
    'SPDX declarations without accompanying license text are explicitly marked below. Every provided bundle input must have a full notice.',
    ...notices.map((item) => [
      `## ${item.name}@${item.version}`, `Package: ${relative(root, item.path)}`, `Declared license: ${item.declaration}`,
      ...(item.texts.length ? item.texts.map((text) => `### ${text.file}\n\n${text.text.trimEnd()}`) : ['Notice status: declaration only; no complete license text was present.']),
    ].join('\n\n')),
    ...(skipped.length ? [`## Symlinked directories excluded\n\n${skipped.sort().join('\n')}`] : []),
  ];
  await mkdir(dirname(options.destination), { recursive: true });
  await writeFile(options.destination, `${sections.join('\n\n')}\n`, { mode: 0o644 });
  return { packages: notices.length, declaredOnly };
}
