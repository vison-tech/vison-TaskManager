# Windows 安装包

当前支持 Windows 10 22H2 / Windows 11 x64，安装后运行本地服务并打开系统浏览器。
内置 Node 24 与 SQLite，目标机器无需安装 Node/npm。Windows Codex 内嵌模式未适配。

## 默认位置

| 用途 | 默认位置 |
| --- | --- |
| 安装程序 | `D:\software\TaskManager`，安装向导可以修改 |
| 数据、配置和日志 | 安装目录旁的 `TaskManager-data\<Windows用户名>` |
| 构建工具及下载缓存 | `D:\software\TaskManager-build-tools` |
| 构建产物及临时验证文件 | 仓库的 `dist\windows` |

配置根目录包含 `config\launcher.json`、`config\launcher.log` 和运行状态；数据库与附件在 `data`。
卸载只清理安装文件，保留外部数据目录。Windows 的开始菜单快捷方式、卸载注册信息和系统临时文件仍可能写入系统盘。
已有 Node 安装位置不由此脚本修改。

## 构建

在 Windows x64、Node 24 下执行：

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package/setup-windows-tools.ps1
npm run typecheck
npm run build
node --test tests/windows-package.test.ts
npm run package:win
```

工具准备脚本从 Node 官方站点下载固定版本的 ZIP，校验 SHA256，保留完整 LICENSE；
从 Inno Setup 官方站点下载并检查安装器数字签名，以当前用户安装到 D 盘。
Inno Setup 安装器/编译器按其自身许可证提供，仅作为构建工具，不纳入应用资源。
需要联网。可以在 `scripts/package/windows.config.json` 调整工具位置和 Node 版本。
脚本的 `-ToolsDirectory` 仅改变本次工具安装位置，使用自定义位置后也要更新 JSON 或传递以下参数。

```powershell
npm run package:win -- --node "D:\tools\node\node.exe" --node-license "D:\tools\node\LICENSE" --iscc "D:\tools\InnoSetup\ISCC.exe" --output "D:\releases\TaskManager-0.1.0"
```

输出目录必须不存在。构建失败不会发布半成品；成功后包含 `.exe` 安装器、应用目录、`verification.json` 和 `SHA256SUMS.txt`。
打包先检查 x64 Node/SQLite、构建 Web 和自包含 Node bundle、收集许可证，再搬移到带中文及空格的目录，
使用只有系统目录的 PATH 验证 SQLite 持久化、Web 静态资源、真实 HTTP 启动、停止快捷入口、进程关闭和数据位置。
最后编译 Inno Setup 安装器。只打包白名单资源，不包含项目数据库、环境变量文件或 node_modules。

## 使用和维护

运行开始菜单的 TaskManager，或双击安装目录的 `TaskManager.cmd`。浏览器会在服务就绪后打开。
保持启动窗口打开，关闭网页不等于停止服务。使用 `Ctrl+C` 或 Stop TaskManager 快捷方式正常退出。
目前没有托盘、原生配置窗口或自动更新。

```powershell
& 'D:\software\TaskManager\TaskManager.cmd' --data-dir 'D:\my-task-data' --port 47831
& 'D:\software\TaskManager\TaskManager.cmd' status
& 'D:\software\TaskManager\TaskManager.cmd' logs
& 'D:\software\TaskManager\TaskManager.cmd' stop
```

首次选择的数据目录会保存。也可用环境变量 `TASKMANAGER_HOME` 更改配置根目录，
`TASKMANAGER_DATA_DIR` 作为首次数据目录，`TASKMANAGER_NO_BROWSER=1` 禁止自动打开浏览器。
自定义配置根目录后应保持相同的环境变量；升级、卸载前自行停止采用自定义 `--config-dir` 的实例。
多用户使用不同的配置/数据目录，但端口仍须避开其他实例；共享磁盘目录的访问权限由 Windows ACL 管理。
升级前备份数据。安装器会尝试正常停止默认配置实例；停止失败时中止升级。

安装程序尚未配置发布者代码签名。公开分发前需补充签名，并在无 Node 的干净机器执行安装、
首次启动、端口冲突、升级保留数据、卸载保留数据等验收。构建内的搬移验证不代替干净机器验收。
