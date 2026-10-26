import type { AgentMessage } from '../../../../packages/contracts/index.ts';

/**
 * Merges a persisted message page with SSE-delta messages. Both sides can drift: the page may
 * already contain the sequence the stream delivered, and the stream can lag a page refetch.
 * The result keeps the page order, dedupes by `sequence`, and appends only unseen deltas.
 */
export function mergeAgentMessages(page: AgentMessage[], delta: AgentMessage[]): AgentMessage[] {
  const seen = new Set<number>();
  const merged: AgentMessage[] = [];
  for (const message of [...page, ...delta]) {
    if (seen.has(message.sequence)) continue;
    seen.add(message.sequence);
    merged.push(message);
  }
  return merged.sort((a, b) => a.sequence - b.sequence);
}
