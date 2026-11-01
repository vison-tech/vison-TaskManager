import { CdpConnection, listCdpTargets, type CdpTarget } from './cdp.ts';
import { buildCodexInjectionScript, buildCodexRemovalScript, isCodexHostUrl } from './codex.ts';
import { startEmbedDiagnostics } from './diagnostics.ts';
import { EmbedFrameLoader } from './frame.ts';
import type { EmbedDocumentSource } from './document.ts';

export interface InjectionConnection {
  readonly isOpen: boolean;
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
  onEvent?(listener: (method: string, params: Record<string, unknown>) => void): () => void;
}
type Session = { connection: InjectionConnection; target: CdpTarget; scriptId: string; stopDiagnostics: () => void; frame: EmbedFrameLoader };
type Evaluation = { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
export type InjectionReport = { active: number; injected: CdpTarget[]; errors: string[] };
type Options = {
  port: number;
  taskboardUrl: string;
  documents: EmbedDocumentSource;
  listTargets?: () => Promise<CdpTarget[]>;
  connect?: (url: string) => Promise<InjectionConnection>;
  onDiagnostic?: (target: CdpTarget, message: string) => void;
};

export function isInjectableTarget(target: CdpTarget): boolean {
  return target.type === 'page' && isCodexHostUrl(target.url);
}

function checkEvaluation(result: Evaluation, accepted: string[]): void {
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Injection script failed');
  if (!accepted.includes(String(result.result?.value))) throw new Error('Injection script did not confirm success');
}

export function requireInjectionSuccess(report: InjectionReport): void {
  if (report.errors.length) throw new Error(`Injection failed: ${report.errors.join('; ')}`);
  if (!report.active) throw new Error('No injectable Codex page was found');
}

/** Owns only this injector's CDP sessions and registered reload scripts. */
export class CodexInjector {
  private readonly sessions = new Map<string, Session>();
  private readonly listTargets: () => Promise<CdpTarget[]>;
  private readonly connect: (url: string) => Promise<InjectionConnection>;
  private readonly script: string;
  private readonly taskboardOrigin: string;
  private readonly onDiagnostic?: Options['onDiagnostic'];
  private readonly documents: EmbedDocumentSource;
  private syncing: Promise<InjectionReport> | null = null;
  private stopping = false;
  private stoppingOperation: Promise<void> | null = null;

  constructor(options: Options) {
    this.listTargets = options.listTargets ?? (() => listCdpTargets(options.port));
    this.connect = options.connect ?? ((url) => CdpConnection.open(url));
    this.script = buildCodexInjectionScript(options.taskboardUrl);
    this.taskboardOrigin = new URL(options.taskboardUrl).origin;
    this.onDiagnostic = options.onDiagnostic;
    this.documents = options.documents;
  }

  sync(): Promise<InjectionReport> {
    if (this.stopping) return Promise.reject(new Error('Injector has stopped'));
    if (!this.syncing) this.syncing = this.syncOnce().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async syncOnce(): Promise<InjectionReport> {
    const targets = (await this.listTargets()).filter(isInjectableTarget);
    const report: InjectionReport = { active: 0, injected: [], errors: [] };
    const live = new Map(targets.map((target) => [target.id, target]));
    for (const [id, session] of this.sessions) {
      if (!live.has(id) || !session.connection.isOpen || live.get(id)?.webSocketDebuggerUrl !== session.target.webSocketDebuggerUrl) {
        session.stopDiagnostics();
        if (session.connection.isOpen) {
          await session.connection.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId }).catch(() => report.errors.push(`${id}: Could not remove the retired reload script`));
          await session.connection.send('Runtime.evaluate', { expression: buildCodexRemovalScript(), returnByValue: true }).catch(() => report.errors.push(`${id}: Could not remove the retired panel`));
        }
        if (session.connection.isOpen) await session.connection.send('Page.setBypassCSP', { enabled: false }).catch(() => report.errors.push(`${id}: Could not restore CSP before retiring the session`));
        session.connection.close();
        this.sessions.delete(id);
      }
    }
    for (const target of targets) {
      if (this.stopping) break;
      const existing = this.sessions.get(target.id);
      if (existing) {
        await existing.frame.sync(existing.connection).catch(() => report.errors.push(`${target.id}: Could not read embedded panel state`));
        continue;
      }
      let connection: InjectionConnection | undefined;
      let scriptId: string | undefined;
      let stopDiagnostics = () => {};
      let cspChanged = false;
      try {
        connection = await this.connect(target.webSocketDebuggerUrl);
        await connection.send('Page.enable');
        // The user-authorized reference approach changes this target's policy while our session is alive.
        cspChanged = true;
        await connection.send('Page.setBypassCSP', { enabled: true });
        if (this.onDiagnostic) stopDiagnostics = await startEmbedDiagnostics(connection, this.taskboardOrigin, (message) => this.onDiagnostic?.(target, message));
        const registered = await connection.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: this.script });
        if (typeof registered.identifier !== 'string' || !registered.identifier) throw new Error('CDP did not return a reload script identifier');
        scriptId = registered.identifier;
        const result = await connection.send<Evaluation>('Runtime.evaluate', { expression: this.script, returnByValue: true });
        checkEvaluation(result, ['injected', 'already-injected']);
        const frame = new EmbedFrameLoader(this.documents, (message) => this.onDiagnostic?.(target, message));
        this.sessions.set(target.id, { connection, target, scriptId, stopDiagnostics, frame });
        report.injected.push(target);
      } catch (error) {
        stopDiagnostics();
        report.errors.push(`${target.id}: ${(error as Error).message}`);
        if (connection) {
          if (scriptId) await connection.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => undefined);
          await connection.send('Runtime.evaluate', { expression: buildCodexRemovalScript(), returnByValue: true }).catch(() => undefined);
          if (cspChanged) await connection.send('Page.setBypassCSP', { enabled: false }).catch(() => report.errors.push(`${target.id}: Could not restore CSP after injection failed`));
          connection.close();
        }
      }
    }
    report.active = this.sessions.size;
    return report;
  }

  // Interactive embedding requires the live document loader and session; the CLI always removes the panel on exit.
  stop(): Promise<void> {
    this.stopping = true;
    this.stoppingOperation ??= this.stopOnce();
    return this.stoppingOperation;
  }

  private async stopOnce(): Promise<void> {
    await this.syncing?.catch(() => undefined);
    const errors: string[] = [];
    for (const session of this.sessions.values()) {
      session.stopDiagnostics();
      let connection = session.connection;
      try {
        if (!connection.isOpen) connection = await this.connect(session.target.webSocketDebuggerUrl);
        if (connection === session.connection && connection.isOpen) {
          await connection.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId }).catch((error: Error) => { errors.push(`${session.target.id}: ${error.message}`); });
        }
        const result = await connection.send<Evaluation>('Runtime.evaluate', { expression: buildCodexRemovalScript(), returnByValue: true });
        checkEvaluation(result, ['removed']);
      } catch (error) { errors.push(`${session.target.id}: ${(error as Error).message}`); }
      finally {
        if (connection.isOpen) await connection.send('Page.setBypassCSP', { enabled: false }).catch(() => errors.push(`${session.target.id}: Could not restore CSP enforcement`));
        connection.close();
        if (connection !== session.connection) session.connection.close();
      }
    }
    this.sessions.clear();
    await this.documents.close().catch(() => errors.push('Could not revoke the embedded session; stop the local service to invalidate it.'));
    if (errors.length) throw new Error(`Could not fully remove Taskboard: ${errors.join('; ')}`);
  }
}
