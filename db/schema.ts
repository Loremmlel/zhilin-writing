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
    markdown: text("markdown").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("replies_post_id_idx").on(table.postId),
    index("replies_root_reply_id_idx").on(table.rootReplyId),
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

export type SiteUser = typeof users.$inferSelect;
export type PostRecord = typeof posts.$inferSelect;
export type ReplyRecord = typeof replies.$inferSelect;
export type AssetRecord = typeof assets.$inferSelect;
