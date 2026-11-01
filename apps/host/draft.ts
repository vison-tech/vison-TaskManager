/** A conservative editor adapter: plain text only, empty current-thread composer, never submit. */
export function buildCodexDraftAdapterSource(): string {
  return `(function createDraftAdapter(observed, error) {
    function editorFor(id) {
      const current = observed();
      if (!current.local || current.sessionId !== id) return null;
      const roots = Array.from(document.querySelectorAll('[data-codex-composer-root][data-composer-placement="thread"]'))
        .filter(root => root.getClientRects().length > 0);
      if (roots.length !== 1) return null;
      const editors = Array.from(roots[0].querySelectorAll('[data-codex-composer="true"][contenteditable="true"]'))
        .filter(editor => editor.getClientRects().length > 0 && !editor.matches('[aria-disabled="true"]'));
      return editors.length === 1 ? editors[0] : null;
    }
    const textOf = editor => (editor.innerText ?? editor.textContent ?? '').replace(/\\r\\n/g, '\\n');
    function empty(editor) {
      return !textOf(editor).trim() && !editor.querySelector('img, [contenteditable="false"], [data-mention], a');
    }
    function supported(id) { return !!id && !!editorFor(id) && typeof document.execCommand === 'function'; }
    async function compose(payload, isCurrent) {
      if (!payload || typeof payload.sessionId !== 'string' || typeof payload.text !== 'string' || !payload.text.trim()
        || payload.text.length > 8000 || payload.text.includes('\\0')) throw error('HOST_INVALID_REQUEST', '草稿内容无效或过长。');
      const id = payload.sessionId.toLowerCase();
      if (!isCurrent()) throw error('HOST_CANCELLED', '宿主请求已取消。');
      const editor = editorFor(id);
      if (!editor || typeof document.execCommand !== 'function') throw error('HOST_UNSUPPORTED', '当前会话输入框不可用，请复制草稿。');
      if (!empty(editor)) throw error('HOST_DRAFT_NOT_EMPTY', 'Codex 输入框已有草稿，请先处理原草稿再填入。');
      editor.focus();
      if (!isCurrent() || editorFor(id) !== editor || !editor.isConnected) throw error('HOST_CONTEXT_CHANGED', '当前会话已变化，请重新确认。');
      if (!empty(editor)) throw error('HOST_DRAFT_NOT_EMPTY', 'Codex 输入框已有草稿，请先处理原草稿再填入。');
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      if (!selection) throw error('HOST_UNAVAILABLE', '无法定位输入框，请复制草稿。');
      selection.removeAllRanges(); selection.addRange(range);
      // Native editing updates the editor's input handlers and undo history; HTML is never inserted.
      const inserted = document.execCommand('insertText', false, payload.text);
      await new Promise(resolve => window.setTimeout(resolve, 0));
      if (!isCurrent() || editorFor(id) !== editor) throw error('HOST_CONTEXT_CHANGED', '会话已变化，请检查原会话中的草稿；未发送消息。');
      if (!inserted || textOf(editor).replace(/\\n$/, '') !== payload.text.replace(/\\r\\n/g, '\\n').replace(/\\n$/, '')) {
        throw error('HOST_DRAFT_UNCONFIRMED', '未能确认完整填入，请检查输入框；未发送消息。');
      }
      return { sessionId: id, prepared: true, sent: false };
    }
    return { supported, compose };
  })`;
}
