import type { AgentMessageKind, AgentMessageRole, AgentStreamMode } from '../contracts/values.ts';

/** A single normalized unit of agent output. Raw stdout is only kept as the transport; this is what a conversation renders. */
export type AgentStreamItem = { role: AgentMessageRole; kind: AgentMessageKind; content: string; data?: unknown };

export interface AgentStreamDecoder {
  /** Feed raw bytes/chunks; returns whatever became visible after this chunk. */
  push(chunk: string): AgentStreamItem[];
  /** Emit a trailing partial line, if the producer did not terminate it with a newline. */
  flush(): AgentStreamItem[];
}

const text = (value: unknown): string => typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value);

// Producer-specific event names are mapped onto the vendor-neutral kind vocabulary.
// Anything unrecognized degrades to plain assistant prose instead of being dropped.
const map: Record<string, { role: AgentMessageRole; kind: AgentMessageKind }> = {
  message: { role: 'assistant', kind: 'message' },
  agent_message: { role: 'assistant', kind: 'message' },
  assistant: { role: 'assistant', kind: 'message' },
  reasoning: { role: 'activity', kind: 'message' },
  command_execution: { role: 'activity', kind: 'command' },
  command: { role: 'activity', kind: 'command' },
  file_change: { role: 'activity', kind: 'file_change' },
  patch: { role: 'activity', kind: 'file_change' },
  mcp_tool_call: { role: 'activity', kind: 'tool_call' },
  tool_call: { role: 'activity', kind: 'tool_call' },
  web_search: { role: 'activity', kind: 'tool_call' },
  todo_list: { role: 'activity', kind: 'message' },
  error: { role: 'system', kind: 'error' },
};

function normalize(value: unknown): AgentStreamItem | null {
  if (typeof value === 'string') return { role: 'assistant', kind: 'message', content: value.slice(0, 65_536) };
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  const shape = map[type] ?? { role: 'assistant' as const, kind: 'message' as const };
  const content = text(record.text ?? record.message ?? record.content ?? record.output ?? record.command ?? record.summary ?? '');
  const detail = record.detail ?? record.data ?? record.result;
  if (!content.trim() && detail === undefined) return null;
  return { role: shape.role, kind: shape.kind, content: content.slice(0, 65_536), ...(detail === undefined ? {} : { data: detail }) };
}

/** Plain text is the default: one chunk equals one assistant message. Nothing is guessed about the producer. */
function textDecoder(): AgentStreamDecoder {
  return {
    push: (chunk) => chunk ? [{ role: 'assistant', kind: 'message', content: chunk }] : [],
    flush: () => [],
  };
}

/** JSONL requires the instance to opt in, because a plain-text producer would otherwise emit unparseable lines. */
function jsonlDecoder(): AgentStreamDecoder {
  let buffer = '';
  const parse = (line: string): AgentStreamItem[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const normalized = normalize(JSON.parse(trimmed) as unknown);
      return normalized ? [normalized] : [];
    } catch {
      // A malformed line is surfaced verbatim rather than silently discarded.
      return [{ role: 'system', kind: 'error', content: trimmed.slice(0, 65_536), data: { unparsed: true } }];
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines.flatMap(parse);
    },
    flush() {
      const rest = buffer;
      buffer = '';
      return parse(rest);
    },
  };
}

export function createStreamDecoder(mode: AgentStreamMode = 'text'): AgentStreamDecoder {
  return mode === 'jsonl' ? jsonlDecoder() : textDecoder();
}

/** Reads the opt-in from the instance environment; only the exact value "jsonl" switches modes. */
export function streamModeFromEnvironment(value: string | undefined): AgentStreamMode {
  return value?.trim().toLowerCase() === 'jsonl' ? 'jsonl' : 'text';
}
