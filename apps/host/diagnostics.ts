export interface DiagnosticConnection {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent?: (listener: (method: string, params: Record<string, unknown>) => void) => () => void;
}

const blockedReasons = new Set([
  'other', 'csp', 'mixed-content', 'origin', 'inspector', 'subresource-filter', 'content-type',
  'coep-frame-resource-needs-coep-header', 'coop-sandboxed-iframe-cannot-navigate-to-coop-page',
  'corp-not-same-origin', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep', 'corp-not-same-site',
]);
const directives = new Set([
  'default-src', 'frame-src', 'child-src', 'frame-ancestors', 'connect-src', 'script-src', 'script-src-elem',
  'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'img-src', 'font-src', 'media-src',
  'object-src', 'worker-src', 'manifest-src', 'base-uri', 'form-action', 'sandbox',
  'upgrade-insecure-requests', 'block-all-mixed-content',
]);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
type ResourceKind = 'document' | 'asset' | 'API';
const resourceTypes: Record<ResourceKind, ReadonlySet<string>> = {
  document: new Set(['Document']),
  asset: new Set(['Script', 'Stylesheet', 'Font', 'Image']),
  API: new Set(['Fetch', 'XHR', 'EventSource']),
};

/** Observe Taskboard documents and capability-scoped resources only; never retrieve bodies or change browser policy. */
export async function startEmbedDiagnostics(
  connection: DiagnosticConnection,
  origin: string,
  report: (message: string) => void,
): Promise<() => void> {
  let stopped = false;
  const notify = (message: string) => {
    if (!stopped) {
      try { report(message); } catch { /* Diagnostics must not interrupt the injector. */ }
    }
  };
  let expectedOrigin: string;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    expectedOrigin = url.origin;
  } catch {
    notify('Taskboard load diagnostics unavailable: invalid document origin.');
    return () => { stopped = true; };
  }
  if (!connection.onEvent) {
    notify('Taskboard load diagnostics unavailable: protocol events are not supported.');
    return () => { stopped = true; };
  }
  const resourceKind = (value: unknown, type?: unknown): ResourceKind | undefined => {
    if (typeof value !== 'string') return undefined;
    try {
      const url = new URL(value);
      if (url.origin !== expectedOrigin || url.username || url.password) return undefined;
      const scoped = /^\/_embed\/[a-f0-9]{64}\/(.*)$/.exec(url.pathname);
      const path = scoped?.[1];
      const kind = url.pathname === '/' || path === '' ? 'document'
        : path?.startsWith('assets/') && path.length > 7 ? 'asset'
          : path?.startsWith('api/v1/') && path.length > 7 ? 'API'
            : undefined;
      if (!kind || (type !== undefined && (typeof type !== 'string' || !resourceTypes[kind].has(type)))) return undefined;
      return kind;
    } catch { return undefined; }
  };
  // Store only opaque request identifiers and fixed categories, never capability URLs or host-page details.
  const requests = new Map<string, ResourceKind>();
  const listener = (method: string, params: Record<string, unknown>) => {
    if (stopped) return;
    const requestId = typeof params.requestId === 'string' && params.requestId.length <= 256 ? params.requestId : undefined;
    if (method === 'Network.requestWillBeSent' && requestId) {
      requests.delete(requestId); // Redirects may reuse an identifier for an unrelated destination.
      const kind = typeof params.type === 'string' ? resourceKind(record(params.request)?.url, params.type) : undefined;
      if (kind) {
        if (requests.size >= 32) requests.delete(requests.keys().next().value!);
        requests.set(requestId, kind);
      }
    } else if (method === 'Network.loadingFinished' && requestId) {
      requests.delete(requestId);
    } else if (method === 'Network.loadingFailed' && requestId && requests.has(requestId)) {
      const kind = requests.get(requestId)!;
      requests.delete(requestId);
      const rawCode = typeof params.errorText === 'string' ? params.errorText.match(/net::ERR_[A-Z_]+/)?.[0] : undefined;
      const code = rawCode && rawCode.length <= 80 ? rawCode : undefined;
      const reason = typeof params.blockedReason === 'string'
        ? blockedReasons.has(params.blockedReason) ? params.blockedReason : 'other'
        : undefined;
      const details = [code, reason ? `blocked=${reason}` : undefined].filter(Boolean).join('; ');
      notify(`Taskboard ${kind} failed to load${details ? ` (${details})` : ''}.`);
    } else if (method === 'Network.responseReceived' && requestId && requests.has(requestId)) {
      const response = record(params.response);
      const kind = requests.get(requestId)!;
      if (typeof params.type !== 'string' || resourceKind(response?.url, params.type) !== kind) {
        requests.delete(requestId);
        return;
      }
      const status = response?.status;
      if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
        requests.delete(requestId);
        notify(`Taskboard ${kind} returned HTTP ${status}.`);
      }
    } else if (method === 'Audits.issueAdded') {
      const issue = record(params.issue);
      if (issue?.code !== 'ContentSecurityPolicyIssue') return;
      const detail = record(record(issue.details)?.contentSecurityPolicyIssueDetails);
      const kind = resourceKind(detail?.blockedURL);
      if (!kind) return;
      const rawDirective = typeof detail?.violatedDirective === 'string' ? detail.violatedDirective.trim().split(/\s+/, 1)[0] : '';
      const directive = directives.has(rawDirective) ? rawDirective : 'unknown-directive';
      if (detail?.isReportOnly === true) {
        notify(`Taskboard ${kind} CSP report-only notice (${directive}); this policy did not enforce a block.`);
      } else {
        notify(`Taskboard ${kind} blocked by Content Security Policy (${directive}).`);
      }
    } else if (method === 'Page.frameNavigated' && resourceKind(record(params.frame)?.unreachableUrl) === 'document') {
      notify('Taskboard document reached a browser error page; check the document failure or CSP diagnostic.');
    }
  };
  let unsubscribe: () => void;
  try { unsubscribe = connection.onEvent(listener); }
  catch {
    notify('Taskboard load diagnostics unavailable: protocol events could not be registered.');
    return () => { stopped = true; };
  }
  await Promise.all([
    ['Network.enable', { maxPostDataSize: 0 }],
    ['Audits.enable', {}],
  ].map(async ([method, params]) => {
    try { await connection.send(method as string, params as Record<string, unknown>); }
    catch { notify(`Taskboard load diagnostics limited: ${method === 'Network.enable' ? 'Network' : 'Audits'} events are unavailable.`); }
  }));
  return () => {
    if (stopped) return;
    stopped = true;
    requests.clear();
    try { unsubscribe(); } catch { /* The owning session is responsible for closing the connection. */ }
  };
}
