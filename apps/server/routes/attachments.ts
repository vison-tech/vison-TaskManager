import type { Hono } from 'hono';
import { actor, routeId } from '../context.ts';
import { Storage } from '../storage.ts';
import { fail } from '../validation.ts';

export function registerAttachmentRoutes(app: Hono, storage: Storage): void {
  app.post('/api/v1/tasks/:id/attachments', async (c) => {
    const id = routeId(c.req.param('id')); const form = await c.req.formData(); const file = form.get('file');
    if (!(file instanceof File)) fail(422, 'VALIDATION_ERROR', 'multipart field file is required');
    if (file.size > 25 * 1024 * 1024) fail(413, 'ATTACHMENT_TOO_LARGE', 'Attachment exceeds 25 MB');
    const commentId = form.get('commentId'); const content = new Uint8Array(await file.arrayBuffer());
    return c.json({ item: storage.write(() => storage.createAttachment(id, { filename: file.name, contentType: file.type || 'application/octet-stream', content }, actor(c.req.raw), typeof commentId === 'string' ? commentId : undefined)) }, 201);
  });

  app.get('/api/v1/attachments/:id', (c) => {
    const result = storage.getAttachment(routeId(c.req.param('id'))); const disposition = /^(text\/html|image\/svg\+xml)$/i.test(result.attachment.contentType) ? 'attachment' : 'inline';
    return new Response(result.content as BodyInit, { headers: { 'Content-Type': result.attachment.contentType, 'Content-Length': String(result.attachment.size), 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.filename)}`, 'X-Content-Type-Options': 'nosniff' } });
  });
  app.delete('/api/v1/attachments/:id', (c) => { storage.write(() => storage.deleteAttachment(routeId(c.req.param('id')), actor(c.req.raw))); return c.body(null, 204); });
}
