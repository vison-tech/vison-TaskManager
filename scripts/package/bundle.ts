import { build, type Metafile } from 'esbuild';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

export function assertSelfContainedBundle(metafile: Metafile): void {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external && !builtins.has(imported.path)) {
        throw new Error(`Packaged code still requires an external module: ${imported.path}`);
      }
    }
  }
}

export async function bundleApplication(root: string, destination: string): Promise<string[]> {
  const entries = ['desktop/index', 'desktop/gui', 'desktop/selfcheck', 'server/index', 'host/inject'];
  const result = await build({
    absWorkingDir: root,
    entryPoints: Object.fromEntries(entries.map((entry) => [`apps/${entry}`, join(root, `apps/${entry}.ts`)])),
    outdir: destination, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node',
    format: 'esm', target: 'node24', packages: 'bundle', metafile: true,
    sourcemap: false, legalComments: 'eof', logLevel: 'warning',
  });
  assertSelfContainedBundle(result.metafile);
  return Object.keys(result.metafile.inputs);
}
