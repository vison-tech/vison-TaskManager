# TaskManager

使用入口：[TaskManaer-Vison 中文使用说明](docs/user-guide.md)（安装、AI 配置、工作区、备份与排错）。


本项目采用 [Apache License 2.0](LICENSE) 开源。

面向人与 AI Agent 协作的本地优先任务工作台。它把项目计划、任务执行、Agent 会话和开发上下文放在同一个工作面板中，支持独立使用，也支持嵌入桌面 Agent。

## 产品定位

- 任务工作台：项目、任务、看板、列表、文档、评论、附件、任务关系、仪表盘和时间轴。
- Agent 协作：Web、CLI 与 MCP 使用同一套业务接口，记录操作来源与会话关联。
- 宿主嵌入：在 Codex、Claude 等桌面 Agent 中打开任务面板，按实际支持能力同步上下文和关联会话。
- 开发上下文：任务可以关联工作区、分支、worktree 和执行会话，方便从计划直接进入实现。
- 可持续扩展：AI 对话、项目自动化、外部项目管理系统、云协作和桌面分发按模块增加。

## 架构方向

采用 TypeScript 模块化单体：React 工作台通过 HTTP 访问本地 Node 服务，SQLite 保存业务数据；Web、CLI 和 MCP 复用共享 HTTP 客户端；宿主适配器负责面板与上下文桥接。

| 层次 | 设计选择 |
| --- | --- |
| 界面 | React、TypeScript、Vite、TanStack Query |
| 服务 | Node.js 24、Hono、Zod |
| 数据 | SQLite、显式 SQL 迁移、独立附件存储 |
| 通用接口 | 共享 schema、HTTP client、CLI、MCP |
| 宿主集成 | 独立 HostAdapter 与版本化 HostBridge |
| 桌面分发 | 后续 launcher；Tauri 为候选方案 |

任务业务不依赖某个 Agent 的页面结构。业务状态、并发版本、关系约束由服务端统一处理，具体边界见架构文档。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [设计文档导航](docs/README.md) | 文档结构、交付层次和验收边界 |
| [架构设计](docs/architecture.md) | 模块边界、数据模型、事务、API、宿主协议和扩展方式 |
| [任务拆分](docs/tasks.md) | T01–T36 主任务、独立子任务、前置依赖、写入范围与验收标准 |
| [功能覆盖表](docs/feature-coverage.md) | 功能与任务映射、参考行为及待核对项 |

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173` 使用 Web 工作台。服务默认监听 `127.0.0.1:47830`，SQLite 数据保存在项目目录的 `.data/taskmanager.sqlite`；可通过 `TASKMANAGER_DATA_DIR` 指定其他数据目录。需要保护实例时设置 `TASKMANAGER_ACCESS_TOKEN`；CLI/MCP 同时设置同名变量后会发送 bearer token。带 `Origin` 的浏览器请求仅接受 localhost/127.0.0.1 或 `TASKMANAGER_ALLOWED_ORIGINS` 中的来源。

常用检查命令：

```bash
npm run typecheck
npm run build
npm test
```

纯逻辑组件的 jsdom 测试与 Node 回归分离运行，互不阻塞（`jsdom` 与 `@testing-library/react` 为 dev 依赖）：

```bash
npm run test:components
```

浏览器回归使用隔离的内存数据库和随机端口，不修改本地任务数据：

```bash
npm run test:browser
```

默认使用本机 Chrome；可通过 `PLAYWRIGHT_CHANNEL` 选择其他已安装的浏览器通道。覆盖卡片点击、同列/跨列拖动与持久化、键盘排序与撤销、写入冲突、评论、任务/README 附件、有向关系、会话关联、归档恢复、任务复制、列表行内编辑、主题/收件箱、仪表盘趋势和窄屏弹窗。

实例数据可用独立附件目录备份和恢复。备份前停止正在写入该实例的进程：

```bash
npm run backup -- create ./backups/$(date +%Y%m%d-%H%M%S)
npm run backup -- restore ./backups/<timestamp> ./.data-restored
```

### macOS 应用（无需安装 Node）

已提供包含 Node 与 SQLite 的 macOS `.app` / ZIP 打包流程。应用窗口支持数据目录、使用方式和端口选择，以及启动、停止、打开看板和查看日志。
当前产物面向 Apple Silicon、macOS 14+，使用本地 ad-hoc 签名，尚未公证；实际安装与 Codex 联动需在目标机器验收。
应用与数据分开存放，首次可选已有目录，新用户默认保存在 `~/Library/Application Support/TaskManager/data`。

构建者需要 Node 24+、项目依赖及 Xcode 编译工具，使用者无需安装 Node 或 npm：

```bash
npm run package:mac -- --node /absolute/path/to/node --node-license /absolute/path/to/Node-LICENSE --arch arm64
```

打包只纳入程序、网页资源、已检查的运行环境及许可证；不会打包开发数据库、启动配置或环境凭证。
命令输出应用和 ZIP 路径；验证报告、校验和及使用说明保存在同一目录。详见 [macOS 打包与使用](docs/macos-package.md)。

### Windows 安装包（无需安装 Node）

已提供 Windows x64 浏览器模式打包流程，内置 Node 24 和 SQLite，支持开始菜单快捷方式和卸载。
程序默认安装到 `D:\software\TaskManager`，数据和日志保存在旁边独立的 `TaskManager-data\<Windows用户名>` 目录。
打包工具也默认放在 D 盘。Windows Codex 内嵌模式尚未适配。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package/setup-windows-tools.ps1
npm run package:win
```

安装目录、使用方式和构建验证见 [Windows 打包与使用](docs/windows-package.md)。

### 源码一键启动

已安装 Node.js 24+ 和项目依赖后，构建一次，再明确选择已有数据目录：

```bash
npm run build
npm run launch -- --data-dir /absolute/path/to/taskmanager-data --port 47831
```

首次选择会保存。以后运行 `npm run launch`，或在 macOS 双击仓库中的 `TaskManager.command`。
启动器会先启动本地服务，收到该子进程的就绪确认后再启动 Codex 注入器；运行时保持终端打开。
如果已有手动启动的服务/注入器，请先在其终端按 Ctrl+C 停止注入器，再停止服务。
端口占用时启动器会报错，不会接管或结束占用端口的进程。

```bash
npm run launch -- status
npm run launch -- stop
npm run launch -- logs
```

`Ctrl+C` 或 `stop` 会先卸载注入器，再关闭本次启动的服务，Codex 应用保持打开。
`--mode web` 仅启动浏览器看板，按输出地址打开；`--no-launch` 仅连接已有调试端口的 Codex。
这些选项会保存，下次可用 `--mode embed --launch-host` 切回默认方式。
凭证仍通过 `TASKMANAGER_ACCESS_TOKEN` 等环境变量提供，不会保存在启动配置中。
macOS 配置与轮换日志默认位于 `~/Library/Application Support/TaskManager`；可用 `--config-dir` 指定其他位置。

这个命令是源码版启动入口；无需本机 Node 的应用使用上面的 macOS 打包方式。托盘、开发者签名/公证与自动更新尚未实现。
启动状态表示服务与注入器已运行，面板实际加载仍以打开后的页面及日志为准。
完整启停和异常恢复步骤见 [启动器验收](docs/desktop-launcher-acceptance.md)。

## Agent 联动

MCP Server 使用 stdio 与桌面 Agent 通讯，再通过本地 HTTP API 访问 TaskManager。它不直接读写 SQLite，因此 Web、CLI 和 MCP 始终使用同一份任务数据。

### CLI

先启动 API，再在另一个终端运行 `taskctl`。CLI 只通过 HTTP 访问当前实例，不会自行创建第二个数据库：

```bash
npm run start

npm run --silent taskctl -- projects list
npm run --silent taskctl -- tasks list --project <project-id>
npm run --silent taskctl -- tasks create --project <project-id> --title "检查 MCP 联动"
npm run --silent taskctl -- tasks update <task-id> --version <version> --status in_review
npm run --silent taskctl -- tasks complete <task-id> --version <version>
npm run --silent taskctl -- tasks comments add <task-id> --body "已完成实现，等待验收"
```

所有读取和写入命令都支持 `--json`。任务、项目、评论、关系和会话的更新/删除命令要求传入当前 `--version`；附件支持 `upload`、`download`、`list` 和 `delete`。可用命令总览：

```bash
npm run --silent taskctl -- --help
```

CLI 使用 `TASKMANAGER_URL`（默认 `http://127.0.0.1:47830`）和 `TASKMANAGER_ACTOR`（默认 `taskctl`），例如：

```bash
TASKMANAGER_URL=http://127.0.0.1:47830 \
TASKMANAGER_ACTOR=local-cli \
TASKMANAGER_ACCESS_TOKEN=<instance-token> \
npm run --silent taskctl -- tasks list --json
```

共享 `TaskClient` 接受显式的 `baseUrl`、`actor`、`timeoutMs` 和可注入 `fetch`。SDK 本身不读取 `process.env`，因此可直接用于浏览器；CLI 与 MCP 只在各自 Node 入口读取环境变量。请求默认 30 秒超时，连接、超时和服务端错误统一为 `ApiError`，写操作不会自动重试。

先启动 API（使用 Web 时可直接运行 `npm run dev`）：

```bash
npm run start
```

另开终端运行 MCP：

```bash
TASKMANAGER_URL=http://127.0.0.1:47830 \
TASKMANAGER_ACTOR=local-agent \
TASKMANAGER_ACCESS_TOKEN=<instance-token> \
npm run --silent mcp
```

当前 MCP 工具包括：`list_projects`、`list_tasks`、`get_task`、`create_task`、`update_task`、`complete_task`、`add_comment`、`add_relation`、`link_session`、`task_tree`。更新、完成任务和增加关系需要传入当前 `version`，旧版本写入会返回冲突错误。

重复任务使用显式完成接口：`POST /api/v1/tasks/:id/complete` 携带当前 `version` 会原子地把任务置为 `done`；任务带 `recurrence` 且有截止日期时，响应中的 `nextTask` 是下一期任务。普通 `PATCH status=done` 不会隐式生成下一期。月末和闰年按原始日期锚点截断，例如 1 月 31 日的月重复会生成 2 月 28/29 日，再回到下一个月的 31 日。

本地 Agent 运行时默认没有可执行命令。需要显式设置 `TASKMANAGER_AGENT_COMMANDS`（逗号分隔的绝对命令路径）；可用模型同样通过 `TASKMANAGER_AGENT_MODELS` 声明，未声明的模型会被拒绝。权限模式使用 `TASKMANAGER_AGENT_PERMISSION_MODES`，技能目录使用 `TASKMANAGER_AGENT_SKILL_DIRS`。命令输出默认按纯文本进对话；只有命令确实输出逐行 JSON 时，才设置 `TASKMANAGER_AGENT_STREAM=jsonl` 启用归一化，否则会出现整行解析失败。项目设置中的自动化只会从服务端返回的命令 allowlist 中选择，配额无法查询时显示 `unknown`。

项目设置还提供 Jira 连接边界。服务从 `TASKMANAGER_JIRA_BASE_URL`、`TASKMANAGER_JIRA_EMAIL`、`TASKMANAGER_JIRA_API_TOKEN` 和可选的 `TASKMANAGER_JIRA_PROJECT_KEY` 读取配置；未配置时连接测试明确返回未配置。当前可测试连接并只读读取 Issue，真实账号下的导入、回写、冲突和归档同步仍需单独验收。

### Codex

在 `~/.codex/config.toml` 添加：

```toml
[mcp_servers.taskmanager]
command = "npm"
args = ["run", "--silent", "mcp"]
cwd = "/Users/vison/IdeaProjects/MyAgent/TaskManager"
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.taskmanager.env]
TASKMANAGER_URL = "http://127.0.0.1:47830"
TASKMANAGER_ACTOR = "codex"
```

把 `cwd` 换成当前仓库绝对路径，重启 Codex 后即可在 MCP 工具列表中看到 TaskManager。Codex 的 MCP 配置由桌面端、CLI 和 IDE 扩展共享；MCP 可用不等于任务面板已经嵌入 Codex 原生窗口，原生面板仍属于后续 HostAdapter 工作。

### Claude Desktop

在 Claude Desktop 配置文件中加入同等的 stdio Server。macOS 默认路径为 `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows 默认路径为 `%APPDATA%\\Claude\\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "taskmanager": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/Users/vison/IdeaProjects/MyAgent/TaskManager",
      "env": {
        "TASKMANAGER_URL": "http://127.0.0.1:47830",
        "TASKMANAGER_ACTOR": "claude"
      }
    }
  }
}
```

启动 Claude Desktop 前确保 API 已运行。Claude Desktop 的 MCP 工具接入与桌面页面注入是两条独立路径；当前稳定可用的是 MCP、CLI 规划中的本地入口和浏览器工作台，Claude 原生面板能力需要单独验证。

## 目标目录

```text
apps/
  server/          本地服务、业务用例、持久化
  web/             独立与嵌入共用的工作台
  cli/             命令行入口
  mcp/             Agent 工具入口
  host/            Codex / Claude 宿主适配
  desktop/         源码启动器、配置、日志与进程管理
packages/
  contracts/       共享 schema、类型、错误与事件
  domain/          纯领域规则
  client/          HTTP 客户端
  agent-runtime/   Agent 执行适配
docs/              设计、任务与验收记录
.memory/           项目上下文
```

## 实施顺序

1. 核对功能基线，同时验证 Codex/Claude 嵌入可行性。
2. 冻结契约，建立数据、运行和访问边界。
3. 打通项目与任务的真实闭环，再完善评论、附件、关系与多视图。
4. 按依赖并行接入 CLI/MCP 和宿主面板。
5. 完成扩展能力及全量对照验收。

精确依赖、接口约定和验收标准见任务文档。
