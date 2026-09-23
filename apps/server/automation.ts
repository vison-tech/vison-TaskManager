import type { AutomationRun } from '../../packages/contracts/index.ts';
import type { AgentEvent, AgentRuntime } from '../../packages/agent-runtime/index.ts';
import type { Storage } from './storage.ts';

export class AutomationScheduler {
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly storage: Storage, private readonly runtime: AgentRuntime, intervalMs = 1000) {
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, Math.max(250, intervalMs));
    this.timer.unref?.();
    void this.tick().catch(() => undefined);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.closed) return;
    for (const automation of this.storage.listAutomations()) {
      if (!automation.enabled || Date.parse(automation.nextRunAt) > now.valueOf()) continue;
      const claimed = this.storage.claimAutomationTrigger(automation.id, now);
      if (!claimed) continue;
      try {
        const run = this.runtime.start({ sessionId: automation.sessionId, command: automation.command, input: automation.input || undefined, model: automation.model, permissionMode: automation.permissionMode, skillIds: automation.skillIds });
        this.storage.updateAutomationRun(claimed.id, { runId: run.runId, status: 'started' });
        this.watch(claimed.id, run.runId);
      } catch (error) {
        this.storage.updateAutomationRun(claimed.id, { status: 'failed', reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  capabilities() { return { scheduler: 'local', quota: { status: 'unknown' as const, reason: 'No provider quota integration is configured for this local instance' } }; }

  close(): void { if (this.closed) return; this.closed = true; clearInterval(this.timer); }

  private watch(automationRunId: string, runId: string) {
    let unsubscribe: (() => void) | undefined;
    const listener = (event: AgentEvent) => {
      if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(event.type)) return;
      unsubscribe?.();
      this.finishAutomationRun(automationRunId, event.type === 'completed' ? 'completed' : 'failed', event.type === 'completed' ? undefined : event.type);
    };
    try {
      unsubscribe = this.runtime.subscribe(runId, listener);
      const run = this.runtime.get(runId);
      if (run && run.status !== 'running') { unsubscribe(); this.finishAutomationRun(automationRunId, run.status === 'completed' ? 'completed' : 'failed', run.status); }
    } catch { const run = this.runtime.get(runId); if (run && run.status !== 'running') this.finishAutomationRun(automationRunId, run.status === 'completed' ? 'completed' : 'failed', run.status); }
  }

  private finishAutomationRun(automationRunId: string, status: 'completed' | 'failed', reason?: string) {
    try { this.storage.updateAutomationRun(automationRunId, { status, reason }); } catch { /* A shutdown can close storage while a child emits its final event. */ }
  }
}

export type { AutomationRun };
