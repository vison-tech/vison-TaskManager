import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { embedConfigKey, embedPathPrefix, embedProtocolVersion, embedSessionPath, type EmbedPageConfig, type EmbedSessionInfo } from '../../packages/contracts/embed.ts';
import { assertLocalTaskboardUrl } from './codex.ts';

export interface EmbedDocumentSource {
  render(capability: string): Promise<string>;
  close(): Promise<void>;
}
type Options = { request?: typeof fetch; accessToken?: string };
const tokenPattern = /^[a-f0-9]{64}$/;

/** Bootstrap through the configured local service; keep the proof key and instance token out of the renderer. */
export async function createEmbedDocumentSource(url: string, options: Options = {}): Promise<EmbedDocumentSource> {
  const origin = assertLocalTaskboardUrl(url);
  const request = options.request ?? fetch;
  const authorization = options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : undefined;
  const send = (path: string, init: RequestInit = {}) => request(`${origin}${path}`, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const response = await send(embedSessionPath, { method: 'POST', headers: authorization });
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new Error('Embedded session was refused; configure the same TASKMANAGER_ACCESS_TOKEN for the service and injector.');
    if (response.status === 404) throw new Error('This TaskManager service has no embedded-session endpoint; restart the local service after updating.');
    throw new Error(`Unable to create an embedded session (HTTP ${response.status}).`);
  }
  const info = await response.json() as EmbedSessionInfo;
  if (!info || info.protocolVersion !== embedProtocolVersion || !tokenPattern.test(info.id) || !tokenPattern.test(info.proofKey)
    || !Number.isFinite(info.expiresAt) || info.expiresAt <= Date.now()) throw new Error('Invalid embedded-session response.');
  const baseUrl = `${origin}${embedPathPrefix}${info.id}`;
  let closed = false;
  let cleanup: Promise<void> | undefined;
  return {
    async render(capability) {
      if (closed) throw new Error('Embedded session is closed.');
      if (!/^[a-f0-9-]{36}$/.test(capability)) throw new Error('Invalid frame capability.');
      const challenge = randomBytes(32).toString('hex');
      const document = await send(`${embedPathPrefix}${info.id}/`, { headers: { 'X-TaskManager-Challenge': challenge }, cache: 'no-store' });
      if (!document.ok || !document.headers.get('content-type')?.includes('text/html')) {
        await document.body?.cancel();
        throw new Error('TaskManager embedded document is unavailable; restart the injector if the service restarted.');
      }
      const html = await document.text();
      const proof = document.headers.get('X-TaskManager-Proof') ?? '';
      const digest = createHash('sha256').update(html).digest('hex');
      const expected = createHmac('sha256', info.proofKey).update(`${challenge}.${digest}`).digest('hex');
      if (!tokenPattern.test(proof) || !timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'))) {
        throw new Error('TaskManager document identity verification failed.');
      }
      if (closed) throw new Error('Embedded session is closed.');
      const config: EmbedPageConfig = { protocolVersion: embedProtocolVersion, baseUrl, capability };
      const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
      const head = /<head(?:\s[^>]*)?>/i;
      if (!head.test(html)) throw new Error('TaskManager document is missing its head element.');
      return html.replace(head, (tag) => `${tag}<base href="${baseUrl}/"><meta name="referrer" content="no-referrer"><script>Object.defineProperty(globalThis,${JSON.stringify(embedConfigKey)},{value:Object.freeze(${serialized})});</script>`);
    },
    close() {
      closed = true;
      cleanup ??= (async () => {
        const revoked = await send(`${embedSessionPath}/${info.id}`, { method: 'DELETE', headers: authorization });
        await revoked.body?.cancel();
        if (!revoked.ok && revoked.status !== 404) throw new Error('Unable to revoke the embedded session.');
      })();
      return cleanup;
    },
  };
}
