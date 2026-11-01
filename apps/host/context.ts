import { buildCodexDraftAdapterSource } from './draft.ts';

/** Read-only context and narrowly scoped navigation adapted from dashi's Codex host integration. */
export function buildCodexContextAdapterSource(): string {
  return `(function createCodexContextAdapter() {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    let disposed = false;
    const pending = new Set();
    const error = (code, message) => Object.assign(new Error(message), { code });
    const normalizeId = (value) => typeof value === 'string' ? value.replace(/^local:/i, '').toLowerCase() : '';
    const clean = (value) => typeof value === 'string' && value.length <= 4096 && !/[\\x00-\\x1f]/.test(value) ? value.trim() : '';
    const available = () => !disposed && typeof window.electronBridge?.sendMessageFromView === 'function';
    function observed() {
      if (Array.from(document.querySelectorAll('[data-codex-composer-root][data-composer-placement="home"]')).some((root) => root.getClientRects().length > 0)) return {};
      const roots = Array.from(document.querySelectorAll('[data-codex-composer-root][data-composer-placement="thread"]'))
        .filter((root) => root.getClientRects().length > 0);
      if (roots.length === 1) {
        const raw = roots[0].querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
        const id = normalizeId(raw);
        if (uuid.test(id)) return { sessionId: id, local: /^local:/i.test(raw) || window.location.pathname.startsWith('/local/') };
        return {};
      }
      if (roots.length > 1) return {};
      const url = new URL(window.location.href);
      const route = url.pathname.startsWith('/local/') ? url.pathname : url.hash.replace(/^#/, '');
      const routeId = /^\\/local\\/([a-f0-9-]{36})(?:\\/|$)/i.exec(route)?.[1]?.toLowerCase();
      if (routeId && uuid.test(routeId)) return { sessionId: routeId, local: true };
      // Sidebar selection can remain stale on new-thread and home screens. It is not active-context evidence.
      return {};
    }
    function theme() {
      const root = document.documentElement;
      const value = root.dataset.theme || root.getAttribute('data-color-theme') || '';
      return /dark/i.test(value) || root.classList.contains('dark') || window.getComputedStyle(root).colorScheme.includes('dark') ? 'dark' : 'light';
    }
    function readThread(id) {
      if (!available()) return Promise.resolve(null);
      return new Promise((resolve) => {
        const requestId = 'taskmanager-context-' + crypto.randomUUID();
        let settled = false;
        let timer;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          window.removeEventListener('message', receive, true);
          pending.delete(cancel);
          resolve(value);
        };
        const cancel = () => finish(null);
        const receive = (event) => {
          // Native Electron responses may have no Window source; child-frame responses are never accepted.
          if (event.source !== null && event.source !== window) return;
          const value = event.data;
          if (!value || value.type !== 'mcp-response' || value.hostId !== 'local' || value.message?.id !== requestId) return;
          const thread = value.message.error ? null : value.message.result?.thread;
          finish(thread && normalizeId(thread.id) === id ? thread : null);
        };
        pending.add(cancel);
        timer = window.setTimeout(cancel, 1500);
        window.addEventListener('message', receive, true);
        try {
          Promise.resolve(window.electronBridge.sendMessageFromView({ type: 'mcp-request', hostId: 'local',
            request: { id: requestId, method: 'thread/read', params: { threadId: id, includeTurns: false } },
            priority: 'interactive', source: 'taskmanager_context', timeoutMs: 1500, expiresAtMs: Date.now() + 1500,
          })).catch(cancel);
        } catch (_) { cancel(); }
      });
    }
    const draft = ${buildCodexDraftAdapterSource()}(observed, error);
    function snapshot(context) {
      return { context, capabilities: {
        embedPanel: { state: 'supported' }, readContext: { state: context.sessionId ? 'supported' : 'unavailable', ...(!context.sessionId ? { reason: '尚未识别当前本地对话，请先在 Codex 打开一个对话。' } : {}) },
        openConversation: available() ? { state: 'supported' } : { state: 'unavailable', reason: '当前 Codex 未提供会话导航所需的本地接口。' },
        composeDraft: draft.supported(context.sessionId) ? { state: 'supported' } : { state: 'unavailable', reason: '当前会话输入框不可用，请复制任务草稿。' },
        runAgent: { state: 'unsupported', reason: '嵌入桥接不执行 Agent 命令。' },
      } };
    }
    async function context(isCurrent = () => true) {
      const start = observed();
      const result = start.sessionId ? await readThread(start.sessionId) : null;
      if (disposed || !isCurrent()) throw error('HOST_CANCELLED', '宿主请求已取消。');
      const current = observed();
      const value = { host: 'codex', theme: theme() };
      if (current.sessionId && current.sessionId === start.sessionId && (current.local || result)) {
        value.sessionId = current.sessionId;
        value.hostId = 'local';
        value.projectKind = 'local';
        // A selected project's root may belong to another thread. Only a verified thread/read supplies cwd.
        if (result && clean(result.cwd)) value.workspacePath = clean(result.cwd);
      }
      return snapshot(value);
    }
    function wait(ms) {
      return new Promise((resolve) => {
        const finish = () => { window.clearTimeout(timer); pending.delete(finish); resolve(); };
        const timer = window.setTimeout(finish, ms);
        pending.add(finish);
      });
    }
    async function openConversation(payload, isCurrent) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.platform !== 'codex' || typeof payload.sessionId !== 'string' || !uuid.test(payload.sessionId)
        || (payload.workspacePath !== undefined && (typeof payload.workspacePath !== 'string' || !clean(payload.workspacePath)))
        || (payload.projectId !== undefined && (typeof payload.projectId !== 'string' || payload.projectId.length > 512))
        || (payload.hostId !== undefined && payload.hostId !== 'local') || (payload.projectKind !== undefined && payload.projectKind !== 'local')) {
        throw error('HOST_UNSUPPORTED', '这里只能打开已关联的本地 Codex 对话。');
      }
      const id = payload.sessionId.toLowerCase();
      if (!available()) throw error('HOST_UNAVAILABLE', '当前 Codex 会话接口不可用。');
      const thread = await readThread(id);
      if (disposed || !isCurrent()) throw error('HOST_CANCELLED', '宿主请求已取消。');
      if (!thread) throw error('HOST_NOT_FOUND', '无法确认这个本地会话，请先在 Codex 中检查会话是否存在。');
      if (payload.workspacePath && clean(thread.cwd) !== clean(payload.workspacePath)) throw error('HOST_CONTEXT_CHANGED', '会话工作区与保存的关联不一致，请核对后重新关联。');
      const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-id]')).find((candidate) => (candidate.getAttribute('data-app-action-sidebar-thread-id') || '').toLowerCase() === 'local:' + id);
      // Unqualified/remote sidebar IDs do not establish local-host ownership; use the explicit local route instead.
      if (observed().sessionId !== id) {
        if (row?.isConnected && !row.matches('[disabled], [aria-disabled="true"]')) row.click();
        else window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(id) }, window.location.origin === 'null' ? '*' : window.location.origin);
      }
      const deadline = Date.now() + 3000;
      while (!disposed && isCurrent() && Date.now() < deadline) {
        if (observed().sessionId === id) return { sessionId: id };
        await wait(80);
      }
      if (disposed || !isCurrent()) throw error('HOST_CANCELLED', '宿主请求已取消。');
      throw error('HOST_NAVIGATION_FAILED', 'Codex 未确认打开目标会话，请在侧栏手动打开后重试。');
    }
    return {
      context,
      async request(action, payload, isCurrent) {
        if (disposed || !isCurrent()) throw error('HOST_CANCELLED', '宿主请求已取消。');
        if (action === 'context') return context(isCurrent);
        if (action === 'openConversation') return openConversation(payload, isCurrent);
        if (action === 'composeDraft') return draft.compose(payload, () => !disposed && isCurrent());
        throw error('HOST_UNSUPPORTED', '不支持此宿主操作。');
      },
      cancel() { for (const stop of [...pending]) stop(); },
      dispose() { disposed = true; for (const stop of [...pending]) stop(); },
    };
  })`;
}
