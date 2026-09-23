import { readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type PermissionMode = 'read' | 'write' | 'full';
export type AgentRunRequest = { sessionId: string; command: string; args?: string[]; cwd?: string; env?: Record<string, string>; model?: string; permissionMode?: PermissionMode; skillIds?: string[]; input?: string };
export type AgentSkill = { id: string; name: string; description: string };
export type AgentEventType = 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type AgentEvent = { sequence: number; runId: string; sessionId: string; type: AgentEventType; data?: string; exitCode?: number | null; signal?: string | null; createdAt: string };
export type AgentRun = { runId: string; sessionId: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; request: AgentRunRequest; startedAt: string; finishedAt?: string; exitCode?: number | null; signal?: string | null };
export type AgentRuntimePersistedRun = { run: AgentRun; events: AgentEvent[] };
export interface AgentRuntimePersistence {
  load(): AgentRuntimePersistedRun[];
  saveRunAndEvent(run: AgentRun, event: AgentEvent): void;
  eventsSince(runId: string, sequence: number): AgentEvent[];
}
export type AgentRuntimeOptions = { allowedCommands: string[]; allowedModels?: string[]; skillDirectories?: string[]; permissionModes?: PermissionMode[]; maxHistory?: number; killGraceMs?: number; persistence?: AgentRuntimePersistence };
export type AgentEventListener = (event: AgentEvent) => void;

export class AgentRuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AgentRuntimeError'; }
}

type ActiveRun = { run: AgentRun; process: ChildProcessWithoutNullStreams; events: AgentEvent[]; nextSequence: number; cancelTimer?: ReturnType<typeof setTimeout> };

export class AgentRuntime {
  private readonly allowedCommands: Set<string>;
  private readonly allowedModels: Set<string>;
  private readonly maxHistory: number;
  private readonly killGraceMs: number;
  private readonly skillsById = new Map<string, AgentSkill & { path: string }>();
  private readonly permissionModes: Set<PermissionMode>;
  private readonly active = new Map<string, ActiveRun>();
  private readonly history = new Map<string, AgentEvent[]>();
  private readonly completed = new Map<string, AgentRun>();
  private readonly subscribers = new Map<string, Set<AgentEventListener>>();
  private readonly persistence?: AgentRuntimePersistence;

  constructor(options: AgentRuntimeOptions) {
    this.allowedCommands = new Set(options.allowedCommands);
    this.allowedModels = new Set(options.allowedModels ?? []);
    this.permissionModes = new Set(options.permissionModes?.length ? options.permissionModes : ['read']);
    this.maxHistory = Math.max(1, options.maxHistory ?? 1000);
    this.killGraceMs = Math.max(100, options.killGraceMs ?? 2000);
    this.persistence = options.persistence;
    this.loadSkills(options.skillDirectories ?? []);
    this.restore();
  }

  skills(): AgentSkill[] { return [...this.skillsById.values()].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, name, description }) => ({ id, name, description })); }
  capabilities() { return { commands: [...this.allowedCommands], models: [...this.allowedModels], permissionModes: [...this.permissionModes], skills: this.skills() }; }

  start(request: AgentRunRequest): AgentRun {
    this.validateRequest(request);
    if (this.activeForSession(request.sessionId)) throw new AgentRuntimeError('SESSION_BUSY', `Session ${request.sessionId} already has a running agent`);
    const run: AgentRun = { runId: randomUUID(), sessionId: request.sessionId, status: 'running', request: { ...request, args: [...(request.args ?? [])], skillIds: [...(request.skillIds ?? [])] }, startedAt: new Date().toISOString() };
    const selectedSkills = (request.skillIds ?? []).map((skillId) => this.skillsById.get(skillId)!);
    const child = spawn(request.command, request.args ?? [], { cwd: request.cwd, env: { ...process.env, ...request.env, ...(selectedSkills.length ? { TASKMANAGER_SKILL_IDS: selectedSkills.map((skill) => skill.id).join(','), TASKMANAGER_SKILL_DIRS: selectedSkills.map((skill) => skill.path).join(delimiter) } : {}) }, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const state: ActiveRun = { run, process: child, events: [], nextSequence: 1 };
    this.active.set(run.runId, state); this.append(state, { type: 'started', data: JSON.stringify({ model: request.model ?? null, permissionMode: request.permissionMode ?? 'read', skillIds: request.skillIds ?? [] }) });
    child.stdout.on('data', (chunk: Buffer) => { if (state.run.status === 'running') this.append(state, { type: 'stdout', data: chunk.toString('utf8') }); });
    child.stderr.on('data', (chunk: Buffer) => { if (state.run.status === 'running') this.append(state, { type: 'stderr', data: chunk.toString('utf8') }); });
    child.once('error', (error) => this.finish(state, 'failed', null, null, error.message));
    child.once('close', (code, signal) => { if (state.run.status === 'running') this.finish(state, code === 0 ? 'completed' : 'failed', code, signal); });
    if (request.input !== undefined) { child.stdin.write(request.input); child.stdin.end(); }
    return { ...run, request: { ...run.request, args: [...(run.request.args ?? [])], skillIds: [...(run.request.skillIds ?? [])] } };
  }

  continue(runId: string, input?: string): AgentRun {
    const previous = this.get(runId);
    if (!previous || previous.status === 'running') throw new AgentRuntimeError('RUN_NOT_FOUND', `Run ${runId} is not available for continuation`);
    return this.start({ ...previous.request, input });
  }

  cancel(runId: string): AgentRun {
    const state = this.active.get(runId);
    if (!state) {
      const completed = this.completed.get(runId);
      if (!completed) throw new AgentRuntimeError('RUN_NOT_FOUND', `Run ${runId} not found`);
      return { ...completed };
    }
    if (state.run.status !== 'running') return { ...state.run };
    state.process.kill('SIGTERM');
    state.cancelTimer = setTimeout(() => { if (state.run.status === 'running') state.process.kill('SIGKILL'); }, this.killGraceMs);
    return { ...state.run };
  }

  get(runId: string): AgentRun | null { const state = this.active.get(runId); return state ? cloneRun(state.run) : this.completed.has(runId) ? cloneRun(this.completed.get(runId)!) : null; }
  eventsSince(runId: string, sequence = 0): AgentEvent[] {
    const local = (this.history.get(runId) ?? []).filter((event) => event.sequence > sequence);
    const persisted = this.persistence?.eventsSince(runId, sequence) ?? [];
    const merged = new Map<number, AgentEvent>();
    for (const event of [...persisted, ...local]) merged.set(event.sequence, event);
    return [...merged.values()].sort((a, b) => a.sequence - b.sequence).map(cloneEvent);
  }
  subscribe(runId: string, listener: AgentEventListener): () => void {
    if (!this.get(runId)) throw new AgentRuntimeError('RUN_NOT_FOUND', `Run ${runId} not found`);
    const listeners = this.subscribers.get(runId) ?? new Set<AgentEventListener>();
    listeners.add(listener); this.subscribers.set(runId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.subscribers.delete(runId); };
  }
  activeForSession(sessionId: string): AgentRun | null { for (const state of this.active.values()) if (state.run.sessionId === sessionId && state.run.status === 'running') return { ...state.run }; return null; }
  shutdown(): void { for (const state of this.active.values()) { state.process.kill('SIGTERM'); state.run.status = 'interrupted'; state.run.finishedAt = new Date().toISOString(); this.append(state, { type: 'interrupted', signal: 'SIGTERM' }); this.completed.set(state.run.runId, { ...state.run }); } this.active.clear(); this.subscribers.clear(); }

  private validateRequest(request: AgentRunRequest) {
    if (!request.sessionId.trim()) throw new AgentRuntimeError('INVALID_SESSION', 'sessionId is required');
    if (!this.allowedCommands.has(request.command)) throw new AgentRuntimeError('COMMAND_NOT_ALLOWED', `Command is not in the runtime allowlist: ${request.command}`);
    if (request.model && !this.allowedModels.has(request.model)) throw new AgentRuntimeError('MODEL_NOT_ALLOWED', `Model is not declared by this runtime: ${request.model}`);
    if (request.cwd && !request.cwd.trim()) throw new AgentRuntimeError('INVALID_CWD', 'cwd cannot be empty');
    if (!this.permissionModes.has(request.permissionMode ?? 'read')) throw new AgentRuntimeError('PERMISSION_MODE_NOT_ALLOWED', `Permission mode is not enabled: ${request.permissionMode ?? 'read'}`);
    for (const skillId of request.skillIds ?? []) if (!this.skillsById.has(skillId)) throw new AgentRuntimeError('SKILL_NOT_FOUND', `Skill is not available: ${skillId}`);
  }

  private loadSkills(directories: string[]) {
    for (const directory of directories) {
      let entries;
      try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || this.skillsById.has(entry.name)) continue;
        const path = join(directory, entry.name);
        const file = join(path, 'SKILL.md');
        try { if (!statSync(file).isFile()) continue; } catch { continue; }
        let source: string;
        try { source = readFileSync(file, 'utf8'); } catch { continue; }
        const name = /^name:\s*(.+)$/m.exec(source)?.[1]?.trim() || entry.name;
        const description = /^description:\s*(.+)$/m.exec(source)?.[1]?.trim() || '';
        this.skillsById.set(entry.name, { id: entry.name, name, description, path });
      }
    }
  }
  private append(state: ActiveRun, input: Omit<AgentEvent, 'sequence' | 'runId' | 'sessionId' | 'createdAt'>) {
    const event: AgentEvent = { sequence: state.nextSequence++, runId: state.run.runId, sessionId: state.run.sessionId, createdAt: new Date().toISOString(), ...input };
    try { this.persistence?.saveRunAndEvent(state.run, event); } catch { /* A closing storage handle must not turn process shutdown into an unhandled rejection. */ }
    state.events.push(event); if (state.events.length > this.maxHistory) state.events.splice(0, state.events.length - this.maxHistory); this.history.set(state.run.runId, state.events.map(cloneEvent));
    for (const listener of this.subscribers.get(state.run.runId) ?? []) { try { listener({ ...event }); } catch { /* A disconnected subscriber cannot affect the run. */ } }
  }
  private finish(state: ActiveRun, status: AgentRun['status'], code: number | null, signal: NodeJS.Signals | null, error?: string) {
    if (state.run.status !== 'running') return;
    if (state.cancelTimer) clearTimeout(state.cancelTimer);
    const cancelled = signal === 'SIGTERM' || signal === 'SIGKILL';
    state.run.status = cancelled ? 'cancelled' : status; state.run.finishedAt = new Date().toISOString(); state.run.exitCode = code; state.run.signal = signal;
    this.append(state, { type: state.run.status === 'cancelled' ? 'cancelled' : state.run.status === 'completed' ? 'completed' : 'failed', data: error, exitCode: code, signal });
    this.active.delete(state.run.runId); this.completed.set(state.run.runId, { ...state.run });
  }

  private restore() {
    for (const persisted of this.persistence?.load() ?? []) {
      const events = persisted.events.map(cloneEvent).sort((a, b) => a.sequence - b.sequence);
      let run = cloneRun(persisted.run);
      this.history.set(run.runId, events.slice(-this.maxHistory));
      if (run.status === 'running') {
        const finishedAt = new Date().toISOString();
        run = { ...run, status: 'interrupted', finishedAt, signal: 'SIGTERM' };
        const event: AgentEvent = { sequence: (events.at(-1)?.sequence ?? 0) + 1, runId: run.runId, sessionId: run.sessionId, type: 'interrupted', signal: 'SIGTERM', createdAt: finishedAt };
        this.persistence?.saveRunAndEvent(run, event);
        events.push(event);
        this.history.set(run.runId, events.slice(-this.maxHistory));
      }
      this.completed.set(run.runId, run);
    }
  }
}

function cloneEvent(event: AgentEvent): AgentEvent { return { ...event }; }
function cloneRun(run: AgentRun): AgentRun { return { ...run, request: { ...run.request, args: [...(run.request.args ?? [])], skillIds: [...(run.request.skillIds ?? [])] } }; }
