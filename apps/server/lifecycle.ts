import type { ServerType } from '@hono/node-server';
import type { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';

interface ManagedParent {
  connected(): boolean;
  ready(port: number, failed: (error: Error) => void): void;
  disconnect(): void;
}

interface ServerLifecycleOptions {
  server: ServerType;
  port: number;
  hostname: string;
  closeRuntime(): void;
  parent?: ManagedParent;
  signals?: Pick<EventEmitter, 'on' | 'off'>;
  shutdownTimeoutMs?: number;
  onListening?: (port: number) => void;
  onFailure?: (error: Error) => void;
}

/** Keep request draining, runtime disposal and parent ownership in one place. */
export function startServerLifecycle(options: ServerLifecycleOptions): { close(): void; closed: Promise<void> } {
  const { server, parent } = options;
  const signals = options.signals ?? process;
  const sockets = new Set<Socket>();
  let stopping = false;
  let finished = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete!: () => void;
  const closed = new Promise<void>((resolve) => { complete = resolve; });
  const report = options.onFailure ?? ((error: Error) => { console.error(error.message); process.exitCode = 1; });

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    server.off('listening', onListening);
    server.off('connection', onConnection);
    signals.off('SIGINT', close);
    signals.off('SIGTERM', close);
    if (parent) signals.off('disconnect', close);
    try { options.closeRuntime(); }
    catch (error) { report(error as Error); }
    finally {
      if (parent?.connected()) {
        try { parent.disconnect(); }
        catch (error) { report(error as Error); }
      }
      complete();
    }
  };
  function close(): void {
    if (stopping) return;
    stopping = true;
    if (!started) { finish(); return; }
    // Stop accepting first. Existing HTTP requests can finish while storage is open.
    timer = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      finish();
    }, options.shutdownTimeoutMs ?? 3000);
    try { server.close(finish); }
    catch (error) { report(error as Error); finish(); }
  }
  const fail = (error: Error) => {
    if (finished) return;
    report(error);
    close();
  };
  const onConnection = (socket: Socket) => {
    if (stopping) { socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => { sockets.delete(socket); });
  };
  const onListening = () => {
    if (stopping) return;
    const address = server.address();
    if (!address || typeof address === 'string') { fail(new Error('TaskManager did not bind a TCP address')); return; }
    options.onListening?.(address.port);
    if (parent) {
      if (!parent.connected()) { close(); return; }
      try { parent.ready(address.port, fail); }
      catch (error) { fail(error as Error); }
    }
  };

  server.on('error', fail);
  server.on('connection', onConnection);
  server.once('listening', onListening);
  signals.on('SIGINT', close);
  signals.on('SIGTERM', close);
  if (parent) signals.on('disconnect', close);
  if (parent && !parent.connected()) close();
  else {
    started = true;
    try { server.listen(options.port, options.hostname); }
    catch (error) { fail(error as Error); }
  }
  return { close, closed };
}
