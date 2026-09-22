import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export async function readInputFile(path: string): Promise<Blob> {
  const content = await readFile(path);
  const mimeByExtension: Record<string, string> = { '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
  return new Blob([content], { type: mimeByExtension[extname(path).toLowerCase()] ?? 'application/octet-stream' });
}
