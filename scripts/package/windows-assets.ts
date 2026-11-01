/** A small code-generated taskboard icon; no external image tooling is needed. */
export function windowsIcon(): Buffer {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const column = (x >= 6 && x <= 10 && y >= 7 && y <= 24)
      || (x >= 14 && x <= 18 && y >= 7 && y <= 18) || (x >= 22 && x <= 26 && y >= 7 && y <= 22);
    const offset = ((size - 1 - y) * size + x) * 4;
    const color = column ? [255, 255, 255, 255] : [220, 99, 37, 255]; // BGRA
    pixels.set(color, offset);
  }
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels.length, 20);
  const bitmap = Buffer.concat([dib, pixels, Buffer.alloc(size * 4)]);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = size; header[7] = size;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(bitmap.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, bitmap]);
}

export const windowsCommand = `@echo off
setlocal
chcp 65001 >nul
"%~dp0runtime\\node.exe" "%~dp0app\\apps\\desktop\\windows.mjs" %*
set "taskmanager_exit=%errorlevel%"
if not "%taskmanager_exit%"=="0" if "%~1"=="" pause
exit /b %taskmanager_exit%
`.replaceAll('\n', '\r\n');

export const windowsReadme = `TaskManager Windows x64 本地版

安装器默认安装到 D:\\software\\TaskManager，可以在安装向导中更改。
已内置 Node 24 和 SQLite，使用者无需安装 Node/npm。
运行开始菜单的 TaskManager（或 TaskManager.cmd），服务就绪后会打开浏览器。
请保持启动窗口打开。按 Ctrl+C 或用 Stop TaskManager 快捷方式正常停止。
浏览器关闭后服务仍运行，需单独停止。当前没有托盘或原生设置窗口。

配置/日志/数据默认在安装目录旁的 TaskManager-data\\<Windows用户名>，
例如 D:\\software\\TaskManager-data\\yourname。卸载和升级保留该目录。
可用环境变量 TASKMANAGER_HOME 改变配置根目录；TASKMANAGER_DATA_DIR 指定已有数据。
也可运行 TaskManager.cmd --data-dir "D:\\your-data" --port 47831，设置会保存。
查看状态/日志：TaskManager.cmd status / TaskManager.cmd logs。
升级和卸载前请先停止应用；升级会尝试请求默认配置的启动器正常停止。
使用自定义 --config-dir 的实例请自行停止，修改配置根目录后不要同时运行旧实例。
本机多用户/多实例请使用不同端口。选择共享的 D 盘目录时请自行设置 Windows 文件权限。

支持 Windows 10 22H2 / Windows 11 x64。当前提供浏览器模式；Windows Codex 内嵌面板尚未适配。
AI 命令行工具仍需单独安装和配置，参考 user-guide.md。
安装包尚未配置发布者代码签名；公开分发前应签名并在干净机器验收。
verification.json 记录构建时的离线数据持久化、真实 HTTP 启停和搬移验证。
`;
