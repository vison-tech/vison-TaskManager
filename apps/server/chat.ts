import type { AgentCatalog, AgentMessage, AgentThread, AgentThreadCompressResult, ProjectSummary } from '../../packages/contracts/index.ts';
import { AgentRuntime, AgentRuntimeError, type AgentEvent, type AgentRun } from '../../packages/agent-runtime/index.ts';
import { fail } from './validation.ts';
import { Storage } from './storage.ts';

export type ChatTurnResult = { thread: AgentThread; message: AgentMessage; run: AgentRun };
export type ChatMessageListener = (message: AgentMessage) => void;
export type ChatCompressOptions = { keep?: number };

const slashCommands = [
  { name: '/context', description: '插入当前任务上下文' },
  { name: '/attach', description: '把任务附件加入上下文' },
  { name: '/stop', description: '停止当前运行' },
];

const terminalText: Record<string, string> = {
  completed: '运行已完成。',
  cancelled: '运行已取消。',
  interrupted: '运行被中断。',
};

export class ChatService {
  private readonly subscribers = new Map<string, Set<ChatMessageListener>>();
  private readonly seen = new Map<string, number>();
  private readonly watching = new Map<string, () => void>();

  constructor(private readonly storage: Storage, private readonly runtime: AgentRuntime) {}

  /**
   * Reports what this instance can actually do. An instance with no allowlisted command gets
   * available: false plus a reason, never a fabricated model list or a fake stream.
   */
  catalog(): AgentCatalog {
    const capabilities = this.runtime.capabilities();
    const commands = capabilities.commands.map((command) => ({
      id: command,
      label: command,
      available: true,
    }));
    const available = commands.length > 0;
    return {
      available,
      reason: available ? null : '当前实例没有配置 TASKMANAGER_AGENT_COMMANDS，AI 对话不可用。',
      stream: capabilities.stream,
      commands,
      models: capabilities.models,
      permissionModes: capabilities.permissionModes,
      skills: capabilities.skills.map((skill) => ({ ...skill, available: true })),
      slashCommands,
    };
  }

  listThreads(filters: { projectId?: string; taskId?: string; limit?: number } = {}): AgentThread[] {
    return this.storage.listAgentThreads(filters);
  }

  getThread(threadId: string): AgentThread { return this.storage.getAgentThread(threadId); }

  createThread(input: { projectId: string; taskId?: string | null; title?: string; sessionId: string; command?: string | null; model?: string | null; permissionMode?: AgentThread['permissionMode']; skillIds?: string[] }): AgentThread {
    return this.storage.write(() => this.storage.createAgentThread(input), { resource: 'agent', resourceId: input.taskId ?? undefined });
  }

  updateThread(threadId: string, input: { version: number; title?: string; command?: string | null; model?: string | null; permissionMode?: AgentThread['permissionMode']; skillIds?: string[] }): AgentThread {
    return this.storage.write(() => this.storage.updateAgentThread(threadId, input), { resource: 'agent', resourceId: threadId });
  }

  deleteThread(threadId: string, version: number): void {
    const thread = this.storage.getAgentThread(threadId);
    const active = this.runtime.activeForSession(thread.sessionId);
    if (active) throw new AgentRuntimeError('SESSION_BUSY', `Thread ${threadId} still has a running agent`);
    this.watching.get(threadId)?.();
    this.watching.delete(threadId);
    this.storage.write(() => this.storage.deleteAgentThread(threadId, version), { resource: 'agent', resourceId: threadId });
  }

  messages(threadId: string, options: { after?: number; before?: number; limit?: number } = {}) {
    return this.storage.listAgentMessagesPage(threadId, options);
  }

  /**
   * Folds the early messages of a thread into a single deterministic summary. A summary is a
   * structured recount of what already happened; without a declared model the agent cannot fold,
   * and a local template posing as model output is never fabricated.
   */
  compressThread(threadId: string, options: ChatCompressOptions = {}): AgentThreadCompressResult {
    if (this.runtime.activeForSession(this.storage.getAgentThread(threadId).sessionId)) {
      throw new AgentRuntimeError('SESSION_BUSY', `Thread ${threadId} still has a running agent`);
    }
    const keep = Math.max(1, Math.trunc(options.keep ?? 20));
    const messages = this.storage.listAllAgentMessages(threadId);
    const summaryMessages = messages.filter((message) => message.kind === 'summary');
    const foldable = messages.filter((message) => message.kind !== 'summary');
    const targetCount = summaryMessages.length + 1 + keep;
    if (foldable.length <= targetCount) {
      return { thread: this.storage.getAgentThread(threadId), summary: null, replacedSequences: [], remainingCount: messages.length };
    }
    const toReplace = foldable.length - keep;
    const replaced = messages.slice(0, toReplace);
    const sections: string[] = [];
    const userTurns = replaced.filter((message) => message.role === 'user' && message.kind === 'message');
    const assistantReplies = replaced.filter((message) => message.role === 'assistant' && message.kind === 'message');
    const toolCalls = replaced.filter((message) => message.kind === 'tool_call');
    const fileChanges = replaced.filter((message) => message.kind === 'file_change');
    const errors = replaced.filter((message) => message.kind === 'error');
    const commands = replaced.filter((message) => message.kind === 'command');
    const runs = [...new Set(replaced.map((message) => message.runId).filter(Boolean))].length;
    const excerpt = (content: string, max = 120) => {
      const flat = content.replace(/\s+/g, ' ').trim();
      return flat.length > max ? `${flat.slice(0, max)}…` : flat;
    };
    if (userTurns.length) sections.push(`用户请求 ${userTurns.length} 次：${userTurns.map((message) => excerpt(message.content)).join('；')}`);
    if (assistantReplies.length) sections.push(`Agent 回复 ${assistantReplies.length} 次`);
    if (toolCalls.length) sections.push(`工具调用 ${toolCalls.length} 项：${excerpt(toolCalls.map((message) => message.content).join(' | '), 200)}`);
    if (commands.length) sections.push(`命令 ${commands.length} 项`);
    if (fileChanges.length) sections.push(`文件变更 ${fileChanges.length} 项`);
    if (errors.length) sections.push(`错误 ${errors.length} 项：${excerpt(errors.map((message) => message.content).join(' | '), 200)}`);
    const content = `历史摘要：折叠了 ${replaced.length} 条早期消息（涉及 ${runs} 次运行，保留最近 ${keep} 条原文）。${sections.join('。')}。`;

    this.storage.write(() => {
      this.storage.deleteAgentMessagesBySequences(threadId, replaced.map((message) => message.sequence));
      this.storage.appendAgentMessage({ threadId, role: 'system', kind: 'summary', content, data: { folded: replaced.map((message) => ({ sequence: message.sequence, role: message.role, kind: message.kind, content: message.content, runId: message.runId, createdAt: message.createdAt })), foldedCount: replaced.length, kept: keep } });
    }, { resource: 'agent', resourceId: threadId });

    const remaining = this.storage.listAllAgentMessages(threadId);
    const summary = remaining.find((message) => message.kind === 'summary');
    return { thread: this.storage.getAgentThread(threadId), summary: summary ?? null, replacedSequences: replaced.map((message) => message.sequence), remainingCount: remaining.length };
  }

  /** Read-only project summary built from task statistics; failures stay visible, nothing is invented. */
  projectSummary(projectId: string): ProjectSummary {
    const stats = this.storage.projectSummary(projectId);
    return { projectId, ...stats, generatedAt: new Date().toISOString() };
  }

  /**
   * Runs one conversational turn. The user message is only persisted after the runtime accepts the
   * run, so a rejected command never leaves an orphaned message behind.
   */
  async turn(threadId: string, input: { input: string; command?: string; model?: string; permissionMode?: AgentThread['permissionMode']; skillIds?: string[] }): Promise<ChatTurnResult> {
    const thread = this.storage.getAgentThread(threadId);
    const sessions = this.runtime.activeForSession(thread.sessionId);
    if (sessions) throw new AgentRuntimeError('SESSION_BUSY', `Thread ${threadId} already has a running agent`);
    const command = input.command ?? thread.command ?? this.runtime.capabilities().commands[0];
    if (!command) throw new AgentRuntimeError('AGENT_UNAVAILABLE', this.catalog().reason ?? 'No agent command is configured');

    const run = this.runtime.start({
      sessionId: thread.sessionId,
      threadId: thread.id,
      command,
      model: input.model ?? thread.model ?? undefined,
      permissionMode: input.permissionMode ?? thread.permissionMode,
      skillIds: input.skillIds ?? thread.skillIds,
      input: input.input,
    });
    this.watch(thread.id);

    const message = this.append(thread.id, { role: 'user', kind: 'message', content: input.input, runId: run.runId });
    this.storage.touchAgentThread(thread.id, { runId: run.runId, messageCount: thread.messageCount + 1, lastMessageAt: message.createdAt });
    return { thread: this.storage.getAgentThread(thread.id), message, run };
  }

  /** Attaches one listener per run so a long thread does not accumulate duplicate subscriptions. */
  private watch(threadId: string) {
    const thread = this.storage.getAgentThread(threadId);
    const run = this.runtime.activeForSession(thread.sessionId);
    if (!run) return;
    this.watching.get(threadId)?.();
    const listener = (event: AgentEvent) => this.consume(threadId, event);
    const unsubscribe = this.runtime.subscribe(run.runId, listener);
    this.watching.set(threadId, unsubscribe);
    // Replay anything the process emitted before the subscription existed.
    for (const event of this.runtime.eventsSince(run.runId, 0)) listener(event);
  }

  /** Maps raw run events onto conversation messages, deduplicated by event sequence. */
  private consume(threadId: string, event: AgentEvent) {
    const last = this.seen.get(event.runId) ?? 0;
    if (event.sequence <= last) return;
    this.seen.set(event.runId, event.sequence);

    for (const item of event.items ?? []) {
      if (!item.content) continue;
      this.append(threadId, {
        role: item.role,
        kind: item.kind,
        content: item.content,
        data: item.data,
        runId: event.runId,
        merge: item.kind === 'message',
      });
    }
    if (event.type === 'failed' && event.data) {
      this.append(threadId, { role: 'system', kind: 'error', content: event.data, runId: event.runId });
    }
    if (['completed', 'cancelled', 'interrupted', 'failed'].includes(event.type)) {
      const text = event.type === 'failed' ? `运行失败${event.exitCode === null || event.exitCode === undefined ? '' : `（exit ${event.exitCode}）`}。` : terminalText[event.type];
      this.append(threadId, { role: 'system', kind: event.type === 'failed' ? 'error' : 'message', content: text, runId: event.runId });
      this.watching.get(threadId)?.();
      this.watching.delete(threadId);
    }
  }

  private append(threadId: string, input: { role: AgentMessage['role']; kind: AgentMessage['kind']; content: string; data?: unknown; runId?: string; merge?: boolean }): AgentMessage {
    const message = this.storage.appendOrMergeAgentMessage({ ...input, threadId });
    for (const listener of this.subscribers.get(threadId) ?? []) {
      try { listener(message); } catch { /* A disconnected browser cannot affect persistence. */ }
    }
    return message;
  }

  subscribeMessages(threadId: string, listener: ChatMessageListener): () => void {
    const listeners = this.subscribers.get(threadId) ?? new Set<ChatMessageListener>();
    listeners.add(listener);
    this.subscribers.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.subscribers.delete(threadId);
    };
  }

  close(): void {
    for (const unsubscribe of this.watching.values()) unsubscribe();
    this.watching.clear();
    this.subscribers.clear();
    this.seen.clear();
  }
}

export function chatError(error: unknown): never {
  if (error instanceof AgentRuntimeError) {
    const status = error.code === 'SESSION_BUSY' ? 409 : error.code === 'RUN_NOT_FOUND' || error.code === 'THREAD_NOT_FOUND' ? 404 : error.code === 'AGENT_UNAVAILABLE' ? 503 : 422;
    fail(status, error.code, error.message);
  }
  throw error;
}
