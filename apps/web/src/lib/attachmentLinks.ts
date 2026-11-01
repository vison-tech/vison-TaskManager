import { webBaseUrl } from './embedded';

// Stored Markdown and agent context must not contain the short-lived embed capability.
export const attachmentPath = (id: string): string => `/api/v1/attachments/${encodeURIComponent(id)}`;
export const projectAttachmentPath = (id: string): string => `/api/v1/project-attachments/${encodeURIComponent(id)}`;

/** Resolve only stable local attachment references, never an external origin or arbitrary API path. */
export function renderedAttachmentUrl(value: string | undefined): string | undefined {
  if (!value || !/^\/api\/v1\/(?:attachments|project-attachments)\/[a-zA-Z0-9_-]+(?:[?#][^\s]*)?$/.test(value)) return value;
  return `${webBaseUrl}${value}`;
}
