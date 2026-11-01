import { basename } from 'node:path';
import type { AgentRunRequest } from './index.ts';

export function isClaudeCommand(command: string): boolean { return /^claude(?:\.exe|\.cmd)?$/.test(basename(command)); }
/** Managed Claude invocation. Generic executable contracts keep their existing argv. */
export function claudeArguments(request: AgentRunRequest, extra: string[]): string[] {
  if (extra.length) throw Object.assign(new Error('Managed Claude arguments cannot be overridden; use a separately named wrapper for custom protocols.'), { code: 'AGENT_ARGUMENTS_UNSUPPORTED' });
  if (request.skillIds?.length) throw Object.assign(new Error('Managed Claude safe mode does not load external skills; use a configured wrapper.'), { code: 'SKILL_NOT_SUPPORTED' });
  const permission = request.permissionMode ?? 'read';
  if (permission === 'full') throw Object.assign(new Error('Unrestricted permissions are not supported by the managed Claude adapter.'), { code: 'PERMISSION_MODE_NOT_ALLOWED' });
  return ['--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--strict-mcp-config', '--safe-mode', '--permission-mode', permission === 'write' ? 'acceptEdits' : 'dontAsk',
    '--tools', permission === 'write' ? 'Read,Grep,Glob,Edit,Write' : 'Read,Grep,Glob',
    ...(request.model ? ['--model', request.model] : [])];
}
