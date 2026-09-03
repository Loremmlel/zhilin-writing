import { sql } from "drizzle-orm";

import { annotationReplies, posts } from "../../db/schema.ts";
import { validateCanonicalAnnotationDocument } from "./invariants.ts";
import { collectAnnotationIds, parseAnnotationMarkdown, stringifyAnnotationMarkdown, visiblePostText } from "./markdown.ts";
import { resolveAnnotationReplyRecipient, validateAnnotationId } from "./policy.ts";
import { wrapAnnotationRange } from "./selection.ts";
import type { AnnotationSelectionDescriptor } from "./types.ts";

type CurrentAnnotationPostState = {
  postId: string; postAuthorId: string; actorUserId: string; title: string; markdown: string;
  currentRevisionId: string; currentRevisionNumber: number; editedAt: Date | null; lastActivityAt: Date; currentAnchorIds: string[];
};

export function planAnnotationCreation(current: CurrentAnnotationPostState, request: {
  baseRevisionId: string; annotationId: string; revisionId: string; selection: AnnotationSelectionDescriptor;
}, now: Date) {
  if (current.currentRevisionId !== request.baseRevisionId) throw new Error("帖子已更新，请重新选择文字后再批注");
  const currentTree = parseAnnotationMarkdown(current.markdown);
  if (!validateCanonicalAnnotationDocument(current.markdown, current.currentAnchorIds).ok) {
    throw new Error("正文批注锚点状态不一致");
  }
  const annotationId = validateAnnotationId(request.annotationId);
  const nextTree = wrapAnnotationRange(currentTree, request.selection, annotationId);
  if (visiblePostText(currentTree) !== visiblePostText(nextTree)) throw new Error("创建批注不能改变正文可见文字");
  const nextAnchorIds = collectAnnotationIds(nextTree);
  const markdown = stringifyAnnotationMarkdown(nextTree);
  if (!validateCanonicalAnnotationDocument(markdown, [...current.currentAnchorIds, annotationId]).ok) {
    throw new Error("正文批注锚点状态不一致");
  }
  return {
    postId: current.postId, title: current.title, markdown, revisionId: request.revisionId,
    revisionKind: "ANNOTATION_STATE" as const, revisionNumber: current.currentRevisionNumber + 1,
    editedAt: current.editedAt, lastActivityAt: now, originalSelectedText: request.selection.selectedText,
    previousAnchorIds: [...current.currentAnchorIds], anchorIds: nextAnchorIds,
    notificationRecipientUserId: current.actorUserId === current.postAuthorId ? null : current.postAuthorId,
  };
}

export async function commitAnnotationMutation<T>(batch: (items: T[]) => Promise<unknown>, items: T[]): Promise<void> {
  if (items.length === 0) throw new Error("批注事务不能为空");
  await batch(items);
}

export function buildImportedThreadRemovalPostGuard(input: {
  currentRevisionId: string;
  annotationId: string;
  retainAnchor: boolean;
}) {
  const revisionGuard = sql`${posts.currentRevisionId} = ${input.currentRevisionId}`;
  if (input.retainAnchor) return revisionGuard;
  return sql`${revisionGuard} AND NOT EXISTS (
    SELECT 1 FROM ${annotationReplies}
    WHERE ${annotationReplies.annotationId} = ${input.annotationId}
      AND ${annotationReplies.sourceType} = 'NATIVE'
      AND ${annotationReplies.deletedAt} IS NULL
  )`;
}

type ReplyTarget = { id: string; annotationId: string; authorId: string | null; deletedAt: Date | null; hiddenAt: Date | null };

export function planAnnotationReplyCreation(annotation: {
  id: string; postId: string; authorId: string | null; hiddenAt: Date | null; currentAnchorIds: string[];
}, input: { actorUserId: string; targetReply: ReplyTarget | null }, now: Date) {
  if (annotation.hiddenAt) throw new Error("该批注当前不可回复");
  if (!annotation.currentAnchorIds.includes(annotation.id)) throw new Error("该批注不属于当前正文");
  if (input.targetReply) {
    if (input.targetReply.annotationId !== annotation.id) throw new Error("回复对象不属于当前批注");
    if (input.targetReply.deletedAt || input.targetReply.hiddenAt) throw new Error("该回复当前不可回复");
  }
  const replyToUserId = input.targetReply?.authorId ?? annotation.authorId;
  return {
    postId: annotation.postId, annotationId: annotation.id, replyToReplyId: input.targetReply?.id ?? null, replyToUserId,
    notificationRecipientUserId: resolveAnnotationReplyRecipient({ actorUserId: input.actorUserId, annotationAuthorId: annotation.authorId, replyToUserId }),
    visualDepth: 1 as const, lastActivityAt: now,
  };
}
