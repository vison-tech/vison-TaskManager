export const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'] as const;
export const priorities = ['none', 'urgent', 'high', 'medium', 'low'] as const;
export const platforms = ['codex', 'claude', 'pi', 'agy', 'grok'] as const;
export const relationTypes = ['parent', 'blocks', 'related'] as const;
export const projectKinds = ['local', 'remote'] as const;
export const agentMessageRoles = ['user', 'assistant', 'activity', 'system'] as const;
export const agentMessageKinds = ['message', 'command', 'file_change', 'tool_call', 'error'] as const;
export const agentStreamModes = ['text', 'jsonl'] as const;

export type Status = typeof statuses[number];
export type Priority = typeof priorities[number];
export type Platform = typeof platforms[number];
export type RelationType = typeof relationTypes[number];
export type ProjectKind = typeof projectKinds[number];
export type AgentMessageRole = typeof agentMessageRoles[number];
export type AgentMessageKind = typeof agentMessageKinds[number];
export type AgentStreamMode = typeof agentStreamModes[number];
