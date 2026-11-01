# 本地 Agent 对话

本机 Claude CLI 的帮助检查已通过。使用现有登录配置，服务启动时显式配置命令：

```sh
TASKMANAGER_AGENT_COMMANDS=/Users/vison/.npm-global/bin/claude \
TASKMANAGER_AGENT_PERMISSION_MODES=read \
TASKMANAGER_DATA_DIR=/absolute/path/to/existing-data \
PORT=47831 node --import tsx apps/server/index.ts
```

将数据目录改为原数据库所在目录，先正常停止旧服务，再启动。不要同时运行占用同一端口的实例。在任务内选择 Agent 后自行点击发送。未在本次开发中向真实模型发送消息；认证、配额和模型可用性仍需实际请求验证。

Claude 适配器自动使用非交互 JSONL、现有认证和模型默认值。默认只提供 Read/Grep/Glob；安全模式关闭自定义插件和 hooks，严格 MCP 配置不继承外部工具。若明确启用 write，提供 Edit/Write 并使用 acceptEdits；full 被拒绝。模型选择需要服务设置 TASKMANAGER_AGENT_MODELS。不接受覆盖这些策略的额外命令参数；自定义通用协议应使用单独命名的显式 allowlist wrapper。技能目录环境变量仅用于通用 wrapper，托管 Claude 安全模式不执行外部技能。

任务对话历史由应用保存并作为后续轮次上下文，Claude 每次使用独立、不持久化的进程会话，不使用全局“最近会话”，避免串线。

本机 Codex CLI 当前缺少 @openai/codex-darwin-arm64 依赖，连 --help 都无法运行；修复安装后才可验收 Codex 命令运行。桌面 Codex 草稿联动不依赖该 CLI。
