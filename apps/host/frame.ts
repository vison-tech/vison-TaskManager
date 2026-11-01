import type { EmbedDocumentRequest, EmbedPanelStatus } from '../../packages/contracts/embed.ts';
import { codexEmbedMarker } from './codex.ts';
import type { EmbedDocumentSource } from './document.ts';

interface FrameConnection { send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> }
interface FrameTree { frame: { id: string; name?: string; url: string; parentId?: string }; childFrames?: FrameTree[] }
type Evaluation = { result?: { value?: unknown }; exceptionDetails?: unknown };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function readStatus(value: unknown): EmbedPanelStatus | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as EmbedPanelStatus;
  if (!['idle', 'loading', 'ready', 'error'].includes(status.phase) || typeof status.open !== 'boolean') return null;
  const request = status.request;
  if (request && (!uuid.test(request.id) || !uuid.test(request.capability) || !new RegExp(`^taskmanager-frame-${uuid.source.slice(1, -1)}$`).test(request.frameName))) return null;
  return status;
}

/** Loads only the isolated direct child created by our panel; no arbitrary renderer URL/request bridge. */
export class EmbedFrameLoader {
  private loadedRequest?: string;
  private reported?: string;
  constructor(private readonly documents: EmbedDocumentSource, private readonly report: (message: string) => void) {}

  private async status(connection: FrameConnection): Promise<EmbedPanelStatus | null> {
    const result = await connection.send<Evaluation>('Runtime.evaluate', {
      expression: `window[${JSON.stringify(codexEmbedMarker)}]?.status?.() ?? null`, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error('Unable to read Taskboard panel state.');
    return readStatus(result.result?.value);
  }

  async sync(connection: FrameConnection): Promise<void> {
    const status = await this.status(connection);
    if (!status?.request) return;
    const request = status.request;
    if (status.phase === 'loading' && this.loadedRequest !== request.id) {
      await this.load(connection, request);
      return;
    }
    const key = `${request.id}:${status.phase}`;
    if (this.reported === key) return;
    if (status.phase === 'ready' && this.loadedRequest === request.id) {
      this.report('Taskboard panel ready: the embedded page rendered and read the TaskManager API.');
      this.reported = key;
    } else if (status.phase === 'error') {
      const code = ['DOCUMENT_LOAD_FAILED', 'WEB_START_FAILED', 'FRAME_TIMEOUT', 'FRAME_NAVIGATED'].includes(status.errorCode ?? '') ? status.errorCode : 'UNKNOWN';
      this.report(`Taskboard panel failed (${code}); use Retry in the panel after resolving the reported load error.`);
      this.reported = key;
    }
  }

  private async load(connection: FrameConnection, request: EmbedDocumentRequest): Promise<void> {
    try {
      const { frameTree } = await connection.send<{ frameTree: FrameTree }>('Page.getFrameTree');
      const frame = frameTree?.childFrames?.find((item) => item.frame.name === request.frameName)?.frame;
      if (!frame) return; // The DOM insertion may not yet have created its browsing context.
      if (frame.url !== 'about:blank' || frame.parentId !== frameTree.frame.id) throw new Error('Unexpected Taskboard frame.');
      const html = await this.documents.render(request.capability);
      const latest = await this.status(connection);
      if (latest?.phase !== 'loading' || latest.request?.id !== request.id) return;
      await connection.send('Page.setDocumentContent', { frameId: frame.id, html });
      this.loadedRequest = request.id;
      this.report('Taskboard document installed; waiting for the embedded page and API to become ready.');
    } catch {
      await connection.send('Runtime.evaluate', {
        expression: `window[${JSON.stringify(codexEmbedMarker)}]?.documentFailed?.(${JSON.stringify(request.id)}, 'DOCUMENT_LOAD_FAILED')`, returnByValue: true,
      }).catch(() => undefined);
      this.report('Taskboard document could not be verified or installed; check that the updated local service is still running.');
    }
  }
}
