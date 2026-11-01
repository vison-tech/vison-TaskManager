import { buildMacApplication, parsePackageArgs } from './release.ts';

buildMacApplication(parsePackageArgs(process.argv.slice(2))).then((result) => {
  console.log(`macOS 试用包已生成：\n${result.app}\n${result.archive}\n检查记录：${result.report}`);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Packaging failed.');
  process.exitCode = 1;
});
