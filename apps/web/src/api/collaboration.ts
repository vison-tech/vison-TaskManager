import type { Attachment, Comment, Relation, Session, Task } from '../../../../packages/contracts/index.ts';
import { client } from './client';

export const collaborationApi = {
  addComment: (task: Task, body: string) => client.addComment(task.id, body),
  updateComment: (comment: Comment, body: string) => client.updateComment(comment.id, body, comment.version),
  deleteComment: (comment: Comment) => client.deleteComment(comment.id, comment.version),
  commentsPage: (task: Task, cursor?: string, limit?: number) => client.listCommentsPage(task.id, cursor, limit),
  activitiesPage: (task: Task, cursor?: string, limit?: number) => client.listActivitiesPage(task.id, cursor, limit),
  uploadAttachment: (task: Task, file: File, commentId?: string) => client.uploadAttachment(task.id, file, file.name, commentId),
  attachmentUrl: (attachment: Attachment) => client.attachmentUrl(attachment.id),
  deleteAttachment: (attachment: Attachment) => client.deleteAttachment(attachment.id),
  addRelation: (task: Task, targetId: string, type: Relation['type']) => client.addRelation(task.id, targetId, type, task.version),
  removeRelation: (task: Task, relation: Relation) => client.removeRelation(relation.id, task.id, task.version),
  addSession: (task: Task, input: Omit<Session, 'id'>) => client.addSession(task.id, { ...input, version: task.version }),
  removeSession: (task: Task, session: Session) => client.removeSession(task.id, session.sessionId, task.version),
};
