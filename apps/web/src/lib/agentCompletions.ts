import type { AgentCatalog, Attachment } from '../../../../packages/contracts/index.ts';

export type CompletionTrigger = '/' | '@';

export interface CompletionToken {
  trigger: CompletionTrigger;
  /** Start of the token, including the trigger character. */
  start: number;
  /** Caret position the token was read at, i.e. the end of the query being replaced. */
  end: number;
  query: string;
}

export interface AgentCompletionCandidate {
  id: string;
  trigger: CompletionTrigger;
  /** Text inserted in place of the token; slash commands are sent as-is, mentions keep a trailing space. */
  insert: string;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  /** Catalog id to activate when the candidate is a skill mention. */
  skillId?: string;
}

export interface CompletionContext {
  catalog: AgentCatalog | null;
  attachments: Attachment[];
  running: boolean;
}

export interface CompletionResult {
  token: CompletionToken;
  candidates: AgentCompletionCandidate[];
  /** Why the list is empty or why every match is unusable; never used to invent a candidate. */
  reason: string | null;
}

const tokenPattern = /(^|[\s([{"'])([/@])([^\s/@]*)$/;
const triggerAlone = /(^|[\s([{"'])([/@])$/;

/**
 * Reads the token the caret sits in. `/` is only a command when nothing but whitespace precedes it,
 * so a path such as `https://example.com` never opens the command list. `@` may follow any text.
 */
export function readCompletionToken(text: string, caret: number): CompletionToken | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = tokenPattern.exec(before) ?? triggerAlone.exec(before);
  if (!match) return null;
  const trigger = match[2] as CompletionTrigger;
  // The pattern can only capture a whitespace-free query, so the token needs no further splitting.
  const query = match[3] ?? '';
  const start = before.length - query.length - 1;
  if (trigger === '/' && text.slice(0, start).trim() !== '') return null;
  return { trigger, start, end: before.length, query };
}

/** Resolves the visible token to candidates; availability comes from the catalog, not from a guess. */
export function resolveCompletions(token: CompletionToken, context: CompletionContext): CompletionResult {
  const query = token.query.toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(query);
  const candidates: AgentCompletionCandidate[] = [];
  let reason: string | null = null;

  if (token.trigger === '/') {
    if (!context.catalog) reason = '仍在读取运行能力，候选暂不可用。';
    else if (!context.catalog.available) reason = context.catalog.reason;
    else {
      for (const command of context.catalog.slashCommands) {
        const unavailable = command.name === '/stop' && !context.running ? '当前没有正在运行的会话。' : undefined;
        if (!matches(command.name)) continue;
        candidates.push({ id: command.name, trigger: '/', insert: command.name, label: command.name, description: command.description, available: !unavailable, reason: unavailable });
      }
    }
  } else {
    const skills = (context.catalog?.skills ?? []).filter((skill) => skill.available);
    for (const skill of skills) {
      if (!matches(skill.id) && !matches(skill.name)) continue;
      candidates.push({ id: `skill:${skill.id}`, trigger: '@', insert: `@${skill.id} `, label: `@${skill.id}`, description: `技能 · ${skill.name}${skill.description ? ` — ${skill.description}` : ''}`, available: true, skillId: skill.id });
    }
    for (const attachment of context.attachments) {
      if (!matches(attachment.filename)) continue;
      candidates.push({ id: `attachment:${attachment.id}`, trigger: '@', insert: `@${attachment.filename} `, label: `@${attachment.filename}`, description: `附件 · ${attachment.contentType} · ${attachment.size} bytes`, available: true });
    }
    if (!candidates.length) {
      reason = context.catalog && !context.catalog.available
        ? context.catalog.reason
        : skills.length === 0 && context.attachments.length === 0
          ? '当前没有可用技能或附件可引用。'
          : '没有匹配的技能或附件。';
    }
  }

  // Usable candidates stay above the ones the instance reports as unavailable.
  return { token, candidates, reason };
}

/** Replaces exactly the read token, leaving the rest of the message and the caret position predictable. */
export function applyCompletion(text: string, token: CompletionToken, candidate: AgentCompletionCandidate): { text: string; caret: number } {
  const next = `${text.slice(0, token.start)}${candidate.insert}${text.slice(token.end)}`;
  return { text: next, caret: token.start + candidate.insert.length };
}

/** Expands a leading slash command; an unknown or unusable command is left untouched for the server. */
export function expandSlashCommand(text: string, running: boolean): string | null {
  const match = /^\s*(\/context|\/attach|\/stop)\s*$/.exec(text);
  if (!match) return null;
  if (match[1] === '/stop' && !running) return null;
  return match[1];
}
