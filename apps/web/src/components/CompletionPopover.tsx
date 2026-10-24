import type { AgentCompletionCandidate } from '../lib/agentCompletions';

export interface CompletionPopoverProps {
  id: string;
  candidates: AgentCompletionCandidate[];
  activeIndex: number;
  reason: string | null;
  onPick: (candidate: AgentCompletionCandidate) => void;
  onHover: (index: number) => void;
}

/**
 * Lists exactly the candidates the resolver returned. Unavailable entries stay visible with their
 * reason and cannot be picked, so the panel never presents an action the runtime will reject.
 */
export function CompletionPopover({ id, candidates, activeIndex, reason, onPick, onHover }: CompletionPopoverProps) {
  if (!candidates.length) {
    return reason ? <div className="agent-completions empty" id={id} role="status">{reason}</div> : null;
  }
  return <div className="agent-completions" id={id} role="listbox" aria-label="补全候选">
    {candidates.map((candidate, index) => <div
      key={candidate.id}
      id={`${id}-option-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      aria-disabled={!candidate.available}
      className={`agent-completion ${index === activeIndex ? 'active' : ''} ${candidate.available ? '' : 'disabled'}`}
      onMouseDown={(event) => { event.preventDefault(); if (candidate.available) onPick(candidate); }}
      onMouseEnter={() => onHover(index)}
    >
      <strong>{candidate.label}</strong>
      <span>{candidate.available ? candidate.description : candidate.reason ?? '不可用'}</span>
    </div>)}
  </div>;
}
