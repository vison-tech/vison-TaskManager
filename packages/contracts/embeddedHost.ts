import type { HostCapabilities, HostContext, SessionRef } from './index.ts';
import { hostCapabilities, projectKinds } from './index.ts';
import { z } from 'zod';

/** Context observed in the host, never an instruction to execute arbitrary code. */
export interface EmbeddedHostContext extends HostContext {
  host: 'codex';
  projectId?: string;
  hostId?: string;
  projectKind?: SessionRef['projectKind'];
}
export interface EmbeddedHostSnapshot {
  context: EmbeddedHostContext;
  capabilities: HostCapabilities;
}
export type EmbeddedHostAction = 'context' | 'openConversation' | 'composeDraft';
export interface EmbeddedHostDraft { sessionId: string; text: string }
export interface EmbeddedHostClient {
  getSnapshot(): EmbeddedHostSnapshot | null;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<EmbeddedHostSnapshot>;
  openConversation(session: SessionRef): Promise<unknown>;
  composeDraft(draft: EmbeddedHostDraft): Promise<unknown>;
}

export const embeddedHostSnapshot = z.object({
  context: z.object({
    host: z.literal('codex'),
    sessionId: z.string().uuid().optional(),
    workspacePath: z.string().min(1).max(4096).optional(),
    projectId: z.string().min(1).max(512).optional(),
    hostId: z.string().min(1).max(512).optional(),
    projectKind: z.enum(projectKinds).optional(),
    theme: z.enum(['light', 'dark']).optional(),
  }).strict(),
  capabilities: hostCapabilities,
}).strict();
