import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const maximumFileBytes = 1024 * 1024;
const maximumLineCharacters = 16 * 1024;
interface PendingLine { decoder: StringDecoder; text: string; discarded: boolean }

/** Secrets are redacted only after assembling a complete line, including split stream chunks. */
export function createLauncherLogger(dir: string, secrets: string[] = [], onLine?: (line: string) => void): {
  write(source: string, chunk: Buffer | string): void;
  flush(): void;
  path: string;
} {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'launcher.log');
  if (!existsSync(path)) writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
  let fileBytes = statSync(path).size;
  const pending = new Map<string, PendingLine>();
  // Newline-containing values are also redacted by each non-empty fragment.
  const values = [...new Set(secrets.flatMap((secret) => [secret, ...secret.split(/[\r\n]+/)]).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const redact = (input: string) => {
    let output = input;
    for (const secret of values) output = output.split(secret).join('[redacted]');
    return output.replace(/\/_embed\/[a-f\d]{64}(?=\/|\b)/gi, '/_embed/[redacted]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]');
  };
  const emit = (source: string, value: string) => {
    const content = redact(value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''));
    const line = `${new Date().toISOString()} [${redact(source)}] ${content}`;
    const bytes = Buffer.byteLength(line) + 1;
    if (fileBytes + bytes > maximumFileBytes) {
      rmSync(`${path}.1`, { force: true });
      renameSync(path, `${path}.1`);
      writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
      fileBytes = 0;
    }
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
    fileBytes += bytes;
    onLine?.(line);
  };
  const consume = (source: string, state: PendingLine, text: string) => {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      const end = newline === -1 ? text.length : newline;
      if (!state.discarded) {
        if (state.text.length + end - start > maximumLineCharacters) {
          state.text = '';
          state.discarded = true;
        } else state.text += text.slice(start, end);
      }
      if (newline !== -1) {
        emit(source, state.discarded ? '[overlong log line omitted]' : state.text);
        state.text = '';
        state.discarded = false;
      }
      start = end + 1;
    }
  };
  return {
    path,
    write(source, chunk) {
      const name = /^[a-zA-Z0-9_-]{1,32}$/.test(source) ? source : 'process';
      let state = pending.get(name);
      if (!state) { state = { decoder: new StringDecoder('utf8'), text: '', discarded: false }; pending.set(name, state); }
      consume(name, state, state.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    },
    flush() {
      for (const [source, state] of pending) {
        consume(source, state, state.decoder.end());
        if (state.discarded || state.text) emit(source, state.discarded ? '[overlong log line omitted]' : state.text);
      }
      pending.clear();
    },
  };
}
