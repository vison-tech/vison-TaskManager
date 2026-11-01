import type { LauncherReady } from '../../packages/contracts/desktop.ts';

interface LifecycleProcess {
  on(event: 'SIGINT' | 'SIGTERM' | 'disconnect', handler: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM' | 'disconnect', handler: () => void): unknown;
  connected?: boolean;
  send?(message: LauncherReady, callback: (error: Error | null) => void): boolean;
  disconnect?(): void;
}
interface LifecycleOptions {
  process: LifecycleProcess;
  instanceId?: string;
  cancelPending(): void;
  onError(error: unknown): void;
}

/** Startup owns eventual resources even when cancellation arrives before they exist. */
export function createInjectorLifecycle(options: LifecycleOptions) {
  const channel = options.process;
  const managed = Boolean(options.instanceId && channel.send);
  let stopped = false;
  let started = false;
  let startupSucceeded = false;
  let notified = false;
  let startup: Promise<void> = Promise.resolve();
  let cleanup: (() => Promise<void>) | undefined;
  let shutdown: Promise<void> | undefined;

  const stop = () => {
    if (shutdown) return shutdown;
    stopped = true;
    options.cancelPending();
    shutdown = (async () => {
      // The initializer can still return a resource after a signal or parent exit.
      await startup.catch(() => undefined);
      try { await cleanup?.(); }
      catch (error) { options.onError(error); }
      finally {
        channel.removeListener('SIGINT', onSignal);
        channel.removeListener('SIGTERM', onSignal);
        if (managed) channel.removeListener('disconnect', onSignal);
        if (managed && channel.connected) {
          try { channel.disconnect?.(); }
          catch (error) { options.onError(error); }
        }
      }
    })();
    return shutdown;
  };
  const onSignal = () => { void stop(); };
  channel.on('SIGINT', onSignal);
  channel.on('SIGTERM', onSignal);
  if (managed) channel.on('disconnect', onSignal);
  if (managed && channel.connected === false) void stop();

  return {
    get stopped() { return stopped; },
    own(dispose: () => Promise<void>) { cleanup = dispose; },
    start(initialize: () => Promise<void>) {
      if (started) throw new Error('Injector initialization has already started.');
      started = true;
      startup = Promise.resolve().then(async () => {
        if (stopped) return;
        await initialize();
        startupSucceeded = !stopped;
      });
      return startup;
    },
    notifyReady() {
      if (!managed || !channel.connected || stopped || !startupSucceeded || notified) return false;
      notified = true;
      const message: LauncherReady = { type: 'taskmanager:ready', instanceId: options.instanceId!, role: 'injector' };
      const failed = (error: unknown) => { options.onError(error); void stop(); };
      try { channel.send!(message, (error) => { if (error) failed(error); }); }
      catch (error) { failed(error); return false; }
      return !stopped;
    },
    stop,
  };
}
