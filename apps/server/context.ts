import { z } from 'zod';
import { fail } from './validation.ts';

export async function body<T>(context: { req: { json: <R>() => Promise<R> } }, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const result = schema.safeParse(value);
  if (!result.success) fail(422, 'VALIDATION_ERROR', 'Request body is invalid', result.error.flatten());
  return result.data;
}

export function actor(request: Request): string {
  return request.headers.get('X-TaskManager-Actor')?.trim() || 'web-user';
}

export function routeId(value: string | undefined): string {
  if (!value) fail(400, 'INVALID_ID', 'A resource id is required');
  return decodeURIComponent(value);
}

export function versionQuery(value: string | undefined): number {
  const version = Number(value);
  if (!Number.isInteger(version)) fail(422, 'VALIDATION_ERROR', 'version query parameter is required');
  return version;
}
