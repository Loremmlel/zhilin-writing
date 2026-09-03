import { contentState, isPostDiscussionReachable, shouldRenderReplyPlaceholder } from "./policy.ts";

type PostLifecycleInput = {
  authorId: string;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

type PublicReplyInput = {
  authorId: string | null;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

export function buildPostLifecycleView(post: PostLifecycleInput, replyRows: PublicReplyInput[]) {
  const { state } = contentState(post);
  const hasOtherMemberDiscussion = isPostDiscussionReachable(post.authorId, replyRows);
  return {
    state,
    contentVisible: state === "normal",
    hasOtherMemberDiscussion,
    discussionReachable: state === "normal" || hasOtherMemberDiscussion,
    placeholder:
      state === "hidden"
        ? "该帖子已被管理员隐藏。"
        : state === "deleted"
          ? "该帖子已被作者删除。"
          : null,
  };
}

type ReplyTreeInput = {
  id: string;
  authorId: string | null;
  rootReplyId: string | null;
  replyToReplyId: string | null;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

export type ReplyLifecycleView<T extends ReplyTreeInput> = T & {
  state: "normal" | "deleted" | "hidden";
  contentVisible: boolean;
  placeholder: string | null;
  visibleDependentCount: number;
  visibleOtherAuthorDependentCount: number;
};

export function buildReplyLifecycleViews<T extends ReplyTreeInput>(
  rows: T[],
  options: { requiredPlaceholderIds?: readonly string[] } = {},
): ReplyLifecycleView<T>[] {
  const active = rows.filter((row) => contentState(row).state === "normal");
  const requiredPlaceholderIds = new Set(options.requiredPlaceholderIds ?? []);
  const result: ReplyLifecycleView<T>[] = [];
  for (const row of rows) {
    const { state } = contentState(row);
    const visibleDependentCount = active.filter(
      (candidate) =>
        candidate.replyToReplyId === row.id ||
        (row.rootReplyId === null && candidate.rootReplyId === row.id),
    ).length;
    const visibleOtherAuthorDependentCount = active.filter(
      (candidate) =>
        candidate.authorId !== row.authorId &&
        (candidate.replyToReplyId === row.id ||
          (row.rootReplyId === null && candidate.rootReplyId === row.id)),
    ).length;
    if (state === "normal") {
      result.push({
        ...row,
        state,
        contentVisible: true,
        placeholder: null,
        visibleDependentCount,
        visibleOtherAuthorDependentCount,
      });
      continue;
    }
    if (
      !shouldRenderReplyPlaceholder({ state, visibleDependentCount }) &&
      !requiredPlaceholderIds.has(row.id)
    )
      continue;
    result.push({
      ...row,
      state,
      contentVisible: false,
      placeholder: state === "hidden" ? "该回复已被管理员隐藏。" : "该回复已被作者删除。",
      visibleDependentCount,
      visibleOtherAuthorDependentCount,
    });
  }
  return result;
}
