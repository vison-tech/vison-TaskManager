/** Private local embedding protocol; never place the instance access token in a frame. */
export const embedProtocolVersion = '1' as const;
export const embedSessionPath = '/api/v1/embed/sessions';
export const embedPathPrefix = '/_embed/';
export const embedConfigKey = '__TASKMANAGER_EMBED__';

export interface EmbedSessionInfo {
  protocolVersion: typeof embedProtocolVersion;
  id: string;
  proofKey: string;
  expiresAt: number;
}
export interface EmbedPageConfig {
  protocolVersion: typeof embedProtocolVersion;
  baseUrl: string;
  capability: string;
}
export interface EmbedDocumentRequest { id: string; frameName: string; capability: string }
export type EmbedPanelError = 'DOCUMENT_LOAD_FAILED' | 'WEB_START_FAILED' | 'FRAME_TIMEOUT' | 'FRAME_NAVIGATED';
export interface EmbedPanelStatus {
  open: boolean;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  request: EmbedDocumentRequest | null;
  errorCode?: EmbedPanelError;
}
