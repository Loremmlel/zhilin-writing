import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const allowedUsers = sqliteTable(
  "allowed_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
    addedByUserId: text("added_by_user_id"),
  },
  (table) => [uniqueIndex("allowed_users_email_unique").on(table.email)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    emailKey: text("email_key").notNull(),
    displayName: text("display_name").notNull(),
    avatarAssetId: text("avatar_asset_id"),
    bio: text("bio").notNull().default(""),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_key_unique").on(table.emailKey),
    uniqueIndex("users_display_name_unique").on(table.displayName),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    searchText: text("search_text").notNull().default(""),
    currentRevisionId: text("current_revision_id"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("posts_published_at_idx").on(table.publishedAt),
    index("posts_last_activity_at_idx").on(table.lastActivityAt),
    index("posts_author_id_idx").on(table.authorId),
  ],
);

export const replies = sqliteTable(
  "replies",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    authorId: text("author_id").notNull().references(() => users.id),
    rootReplyId: text("root_reply_id"),
    replyToUserId: text("reply_to_user_id").references(() => users.id),
    submissionKey: text("submission_key"),
    markdown: text("markdown").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("replies_post_id_idx").on(table.postId),
    index("replies_root_reply_id_idx").on(table.rootReplyId),
    uniqueIndex("replies_author_submission_unique").on(table.authorId, table.submissionKey),
  ],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull().references(() => users.id),
    eventType: text("event_type", { enum: ["POST_CREATED", "POST_REPLY_CREATED"] }).notNull(),
    postId: text("post_id").notNull().references(() => posts.id),
    replyId: text("reply_id").references(() => replies.id),
    rootReplyId: text("root_reply_id"),
    replyToUserId: text("reply_to_user_id").references(() => users.id),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    invalidatedAt: integer("invalidated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("activity_events_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("activity_events_post_created_idx").on(table.postId, table.createdAt),
    index("activity_events_type_created_idx").on(table.eventType, table.createdAt),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
    actorUserId: text("actor_user_id").notNull().references(() => users.id),
    eventId: text("event_id").notNull().references(() => activityEvents.id),
    notificationType: text("notification_type", { enum: ["POST_REPLY_RECEIVED"] }).notNull(),
    postId: text("post_id").notNull().references(() => posts.id),
    replyId: text("reply_id").references(() => replies.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
    index("notifications_recipient_read_created_idx").on(table.recipientUserId, table.readAt, table.createdAt),
    index("notifications_event_id_idx").on(table.eventId),
    uniqueIndex("notifications_event_recipient_type_unique").on(table.eventId, table.recipientUserId, table.notificationType),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("tags_normalized_name_unique").on(table.normalizedName)],
);

export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id").notNull().references(() => posts.id),
    tagId: text("tag_id").notNull().references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tagId] })],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id),
    postId: text("post_id").references(() => posts.id),
    r2Key: text("r2_key").notNull(),
    kind: text("kind", { enum: ["avatar", "image", "attachment"] }).notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status", { enum: ["temporary", "permanent"] }).notNull().default("temporary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    boundAt: integer("bound_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("assets_r2_key_unique").on(table.r2Key),
    index("assets_owner_status_idx").on(table.ownerId, table.status),
    index("assets_post_id_idx").on(table.postId),
    index("assets_expires_at_idx").on(table.expiresAt),
  ],
);

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    restoreSourceRevisionId: text("restore_source_revision_id"),
  },
  (table) => [
    uniqueIndex("post_revisions_post_number_unique").on(table.postId, table.revisionNumber),
    index("post_revisions_post_created_idx").on(table.postId, table.createdAt),
  ],
);

export const postAssetRefs = sqliteTable(
  "post_asset_refs",
  {
    postId: text("post_id").notNull().references(() => posts.id),
    assetId: text("asset_id").notNull().references(() => assets.id),
    usage: text("usage", { enum: ["inline", "attachment"] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.assetId, table.usage] }),
    index("post_asset_refs_asset_idx").on(table.assetId),
  ],
);

export const revisionAssetRefs = sqliteTable(
  "revision_asset_refs",
  {
    revisionId: text("revision_id").notNull().references(() => postRevisions.id),
    assetId: text("asset_id").notNull().references(() => assets.id),
    usage: text("usage", { enum: ["inline", "attachment"] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.assetId, table.usage] }),
    index("revision_asset_refs_asset_idx").on(table.assetId),
  ],
);

export type SiteUser = typeof users.$inferSelect;
export type PostRecord = typeof posts.$inferSelect;
export type ReplyRecord = typeof replies.$inferSelect;
export type ActivityEventRecord = typeof activityEvents.$inferSelect;
export type NotificationRecord = typeof notifications.$inferSelect;
export type AssetRecord = typeof assets.$inferSelect;
export type PostRevisionRecord = typeof postRevisions.$inferSelect;
export type PostAssetRefRecord = typeof postAssetRefs.$inferSelect;
export type RevisionAssetRefRecord = typeof revisionAssetRefs.$inferSelect;
