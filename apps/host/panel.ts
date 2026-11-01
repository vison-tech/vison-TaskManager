import { buildCodexContextAdapterSource } from './context.ts';

/** Serialized UI controller. The injector supplies the document; the frame never navigates to loopback. */
export function buildCodexPanelControllerSource(): string {
  return `(function createTaskboardPanel(label, changed, focusEntry) {
    let surface = null, frame = null, notice = null, message = null, retry = null, close = null;
    let opened = false, disposed = false, phase = 'idle', request = null, challenge = '', errorCode;
    let timeout = null, hostTimer = null, contextPending = null, actionPending = false, hostGeneration = 0;
    const seenRequests = new Set();
    const host = ${buildCodexContextAdapterSource()}();
    const requestUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    function stopHost() {
      hostGeneration++;
      if (hostTimer !== null) window.clearInterval(hostTimer);
      hostTimer = null;
      contextPending = null;
      actionPending = false;
      host.cancel();
    }
    function currentHostChannel() {
      const target = frame, generation = hostGeneration, cap = request?.capability, proof = challenge;
      const valid = () => !disposed && opened && phase === 'ready' && generation === hostGeneration && target === frame && frame?.isConnected && cap === request?.capability && proof === challenge;
      return { valid, send(value) { if (valid()) target.contentWindow?.postMessage({ ...value, capability: cap, challenge: proof }, '*'); } };
    }
    async function refreshContext() {
      if (contextPending !== null || !opened || phase !== 'ready' || disposed) return;
      const generation = hostGeneration, channel = currentHostChannel();
      contextPending = generation;
      try { const payload = await host.context(channel.valid); channel.send({ type: 'taskmanager:host-context', payload }); }
      catch (_) { /* Replacement/close invalidates the pending context. */ }
      finally { if (contextPending === generation) contextPending = null; }
    }
    function startHost() {
      if (!opened || phase !== 'ready' || disposed) return;
      if (hostTimer === null) hostTimer = window.setInterval(refreshContext, 2000);
      void refreshContext();
    }
    async function hostRequest(value) {
      if (!opened || phase !== 'ready' || typeof value.requestId !== 'string' || !requestUuid.test(value.requestId) || seenRequests.has(value.requestId)) return;
      const channel = currentHostChannel();
      const reply = (value) => channel.send({ type: 'taskmanager:host-response', requestId: value.requestId, ...value });
      const reject = (code, message) => reply({ requestId: value.requestId, ok: false, error: { code, message } });
      if (!['context', 'openConversation', 'composeDraft'].includes(value.action)) { reject('HOST_UNSUPPORTED', '不支持此宿主操作。'); return; }
      let size;
      try { size = JSON.stringify(value.payload ?? {}).length; } catch (_) { return; }
      if (size > 12000 || (value.action === 'composeDraft' && (typeof value.payload?.text !== 'string' || value.payload.text.length > 8000))) { reject('HOST_INVALID_REQUEST', '宿主请求内容无效或过长。'); return; }
      if (actionPending) { reject('HOST_BUSY', '上一项宿主操作尚未完成，请稍后重试。'); return; }
      // At this point no action is in flight, so evict only the oldest completed request.
      if (seenRequests.size >= 256) seenRequests.delete(seenRequests.values().next().value);
      seenRequests.add(value.requestId);
      actionPending = true;
      const generation = hostGeneration;
      try {
        const payload = await host.request(value.action, value.payload, channel.valid);
        reply({ requestId: value.requestId, ok: true, payload });
        if (['openConversation', 'composeDraft'].includes(value.action) && channel.valid()) setOpen(false);
      } catch (failure) { reject(typeof failure.code === 'string' && failure.code.startsWith('HOST_') ? failure.code : 'HOST_ERROR', typeof failure.code === 'string' && failure.code.startsWith('HOST_') ? failure.message : '宿主操作未能完成，请重试。'); }
      finally { if (generation === hostGeneration) actionPending = false; }
    }
    const text = (zh, en) => label() === '任务面板' ? zh : en;
    const allowedErrors = new Set(['DOCUMENT_LOAD_FAILED', 'WEB_START_FAILED', 'FRAME_TIMEOUT', 'FRAME_NAVIGATED']);
    const clearTimer = () => { if (timeout !== null) window.clearTimeout(timeout); timeout = null; };

    function render() {
      if (!surface) return;
      surface.style.display = opened ? 'block' : 'none';
      surface.setAttribute('aria-busy', String(phase === 'loading'));
      if (frame) frame.style.display = opened && phase === 'ready' ? 'block' : 'none';
      notice.style.display = phase === 'ready' ? 'none' : 'flex';
      const copy = phase === 'error'
        ? text('任务面板未能加载，请重试。若仍失败，请查看启动终端。', 'Taskboard could not load. Retry, or check the launcher output if the problem continues.')
        : text('正在加载任务面板…', 'Loading Taskboard…');
      if (message.textContent !== copy) message.textContent = copy;
      notice.setAttribute('role', phase === 'error' ? 'alert' : 'status');
      retry.hidden = phase !== 'error';
    }

    function fail(id, code) {
      if (disposed || !request || request.id !== id || !allowedErrors.has(code)) return;
      clearTimer();
      stopHost();
      phase = 'error';
      errorCode = code;
      challenge = '';
      render();
      changed();
    }

    function challengeFrame(target) {
      if (disposed || target !== frame || !request || phase === 'error') return;
      if (phase === 'ready') { fail(request.id, 'FRAME_NAVIGATED'); return; }
      challenge = crypto.randomUUID();
      target.contentWindow?.postMessage({ type: 'taskmanager:challenge', capability: request.capability, challenge }, '*');
    }

    function replaceFrame() {
      clearTimer();
      stopHost();
      seenRequests.clear();
      frame?.remove();
      challenge = '';
      errorCode = undefined;
      phase = 'loading';
      request = { id: crypto.randomUUID(), frameName: 'taskmanager-frame-' + crypto.randomUUID(), capability: crypto.randomUUID() };
      const next = document.createElement('iframe');
      next.id = 'taskmanager-codex-panel';
      next.name = request.frameName;
      next.title = label();
      next.setAttribute('aria-label', label());
      next.setAttribute('data-taskmanager-owned', 'true');
      next.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-downloads allow-popups');
      next.referrerPolicy = 'no-referrer';
      next.src = 'about:blank';
      next.style.cssText = 'width:100%;height:100%;border:0;display:none;border-radius:12px;background:#fff';
      next.addEventListener('load', () => challengeFrame(next));
      frame = next;
      surface.prepend(next);
      const id = request.id;
      timeout = window.setTimeout(() => fail(id, 'FRAME_TIMEOUT'), 20000);
      render();
    }

    function createSurface() {
      surface = document.createElement('div');
      surface.id = 'taskmanager-codex-surface';
      surface.setAttribute('data-taskmanager-owned', 'true');
      surface.style.cssText = 'position:fixed;z-index:2147483645;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgba(0,0,0,.2);display:none';
      notice = document.createElement('div');
      notice.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:48px;color:#475467;font:14px system-ui;text-align:center';
      message = document.createElement('p');
      retry = document.createElement('button');
      retry.id = 'taskmanager-codex-retry';
      retry.type = 'button';
      retry.textContent = text('重试', 'Retry');
      retry.style.cssText = 'padding:7px 16px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;color:#1d2939;cursor:pointer;font:14px system-ui';
      retry.addEventListener('click', () => { if (!disposed) { replaceFrame(); changed(); close.focus(); } });
      notice.append(message, retry);
      close = document.createElement('button');
      close.id = 'taskmanager-codex-close';
      close.type = 'button';
      close.setAttribute('data-taskmanager-owned', 'true');
      close.textContent = '×';
      close.setAttribute('aria-label', text('关闭任务面板', 'Close Taskboard'));
      close.style.cssText = 'position:absolute;z-index:1;top:8px;right:8px;width:28px;height:28px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;color:#1d2939;cursor:pointer;font:20px system-ui';
      close.addEventListener('click', () => setOpen(false));
      surface.append(notice, close);
      document.body.append(surface);
      replaceFrame();
    }

    function place() {
      if (!surface || !opened) return;
      const host = document.querySelector('.app-shell-main-content-frame');
      if (host) {
        const rect = host.getBoundingClientRect();
        Object.assign(surface.style, { left: rect.left + 8 + 'px', top: rect.top + 8 + 'px', width: Math.max(0, rect.width - 16) + 'px', height: Math.max(0, rect.height - 16) + 'px', right: '', bottom: '' });
      } else {
        Object.assign(surface.style, { right: '16px', bottom: '16px', width: 'min(960px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 32px))', left: '', top: '' });
      }
    }

    function sync() {
      if (disposed || !opened || !document.body) return;
      if (!surface) createSurface();
      else {
        const moved = !surface.isConnected || surface.parentElement !== document.body;
        if (moved) document.body.append(surface);
        if (notice.parentElement !== surface) surface.append(notice);
        if (close.parentElement !== surface) surface.append(close);
        if (moved || !frame?.isConnected || frame.parentElement !== surface) replaceFrame();
      }
      place();
      render();
    }

    function setOpen(next) {
      if (disposed) return;
      opened = Boolean(next);
      if (!opened) stopHost();
      sync();
      render();
      changed();
      if (opened) { close?.focus(); startHost(); }
      else focusEntry();
    }

    const onMessage = (event) => {
      if (disposed || !frame || !request || !challenge) return;
      const value = event.data;
      if (event.source !== frame.contentWindow || event.origin !== 'null' || !value || typeof value !== 'object') return;
      if (value.capability !== request.capability || value.challenge !== challenge) return;
      if (value.type === 'taskmanager:host-request') { void hostRequest(value); return; }
      if (phase !== 'loading') return;
      if (value.type === 'taskmanager:error') { fail(request.id, 'WEB_START_FAILED'); return; }
      if (value.type !== 'taskmanager:ready') return;
      clearTimer();
      phase = 'ready';
      render();
      changed();
      startHost();
    };
    window.addEventListener('message', onMessage);
    return {
      isOpen: () => opened,
      setOpen,
      sync,
      place,
      status: () => ({ open: opened, phase, request: request ? { ...request } : null, ...(errorCode ? { errorCode } : {}) }),
      documentFailed: fail,
      remove() {
        disposed = true;
        clearTimer();
        stopHost();
        host.dispose();
        window.removeEventListener('message', onMessage);
        surface?.remove();
        request = null;
      },
    };
  })`;
}
