# TaskManager

面向人与 AI Agent 协作的本地优先任务工作台。它把项目计划、任务执行、Agent 会话和开发上下文放在同一个工作面板中，支持独立使用，也支持嵌入桌面 Agent。

## 产品定位

- 任务工作台：项目、任务、看板、列表、文档、评论、附件、任务关系、仪表盘和时间轴。
- Agent 协作：Web、CLI、MCP 使用同一套业务接口，记录操作来源与会话关联。
- 宿主嵌入：在 Codex、Claude 等桌面 Agent 中打开任务面板，按实际支持能力同步上下文和关联会话。
- 开发上下文：任务可以关联工作区、分支、worktree 和执行会话，方便从计划直接进入实现。
- 可持续扩展：AI 对话、项目自动化、外部项目管理系统、云协作和桌面分发按模块增加。

## 架构方向

采用 TypeScript 模块化单体：React 工作台通过 HTTP 访问本地 Node 服务，SQLite 保存业务数据；CLI 和 MCP 复用共享客户端；宿主适配器负责面板与上下文桥接。

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

## 目标目录

```text
apps/
  server/          本地服务、业务用例、持久化
  web/             独立与嵌入共用的工作台
  cli/             命令行入口
  mcp/             Agent 工具入口
  host/            Codex / Claude 宿主适配
  desktop/         后续桌面启动器
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
