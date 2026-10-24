import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentCatalog, Attachment } from '../../../../packages/contracts/index.ts';
import { applyCompletion, readCompletionToken, resolveCompletions, type AgentCompletionCandidate } from '../lib/agentCompletions';
import { CompletionPopover } from './CompletionPopover';

const popoverId = 'agent-completions-popover';

export interface AgentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  running: boolean;
  catalog: AgentCatalog | null;
  attachments: Attachment[];
  disabled?: boolean;
  onCandidate?: (candidate: AgentCompletionCandidate) => void;
}

const tokenKey = (token: { start: number; query: string } | null) => token ? `${token.start}:${token.query}` : null;

/**
 * Message box with `/` and `@` completion. The list opens only while the caret token is being typed,
 * so a picked command is not immediately re-suggested. Candidates come from the server catalog; an
 * instance without skills or attachments shows the reason instead of a generated list.
 */
export function AgentComposer({ value, onChange, onSubmit, running, catalog, attachments, disabled, onCandidate }: AgentComposerProps) {
  const [caret, setCaret] = useState(0);
  // The token the user is typing into. Clicks and edits elsewhere never open the list on their own.
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Picking and dismissing both happen on keydown, and the matching keyup must not reopen the list.
  const suppressKeyUp = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const token = useMemo(() => readCompletionToken(value, caret), [value, caret]);
  const result = useMemo(() => token ? resolveCompletions(token, { catalog, attachments, running }) : null, [token, catalog, attachments, running]);
  const key = tokenKey(token);
  const open = Boolean(result && result.candidates.length > 0 && activeToken !== null && activeToken === key);
  const candidates = result?.candidates ?? [];
  const active = Math.min(activeIndex, Math.max(candidates.length - 1, 0));

  useEffect(() => { setActiveIndex(0); }, [key]);
  // The caret is restored after React paints, otherwise the browser resets it to the end.
  useEffect(() => {
    if (pendingCaret.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = null;
  });

  function syncCaret(next: string, position: number) {
    setCaret(position);
    setActiveToken(tokenKey(readCompletionToken(next, position)));
  }

  function pick(candidate: AgentCompletionCandidate) {
    if (!token) return;
    const next = applyCompletion(value, token, candidate);
    pendingCaret.current = next.caret;
    onChange(next.text);
    // Applying a candidate ends the token, so the list must not reopen on the inserted text.
    suppressKeyUp.current = true;
    setActiveToken(null);
    onCandidate?.(candidate);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((current) => (current + step + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); suppressKeyUp.current = true; setActiveToken(null); return; }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const candidate = candidates[active];
        if (candidate?.available) pick(candidate);
        return;
      }
    }
    // A textarea never submits a form, so Enter is wired explicitly; Shift+Enter keeps the newline.
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); }
  }

  const describes = Boolean(open || (result?.reason && key === activeToken));

  return <>
    <textarea
      ref={ref}
      rows={3}
      value={value}
      aria-describedby={describes ? popoverId : undefined}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={describes ? popoverId : undefined}
      aria-activedescendant={open ? `${popoverId}-option-${active}` : undefined}
      placeholder="输入任务请求；/ 选择命令，@ 引用技能或附件，Enter 发送，Shift+Enter 换行"
      disabled={disabled}
      onChange={(event) => { const next = event.target.value; onChange(next); syncCaret(next, event.target.selectionStart ?? next.length); }}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (suppressKeyUp.current) { suppressKeyUp.current = false; return; }
        if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) syncCaret(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
      }}
      onClick={(event) => syncCaret(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
    />
    <CompletionPopover
      id={popoverId}
      candidates={open ? candidates : []}
      activeIndex={active}
      reason={open || (result?.reason && key === activeToken) ? result?.reason ?? null : null}
      onPick={pick}
      onHover={setActiveIndex}
    />
  </>;
}
