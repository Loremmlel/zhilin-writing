import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    creationSubmissionKey: text("creation_submission_key"),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    searchText: text("search_text").notNull().default(""),
    currentRevisionId: text("current_revision_id"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
    hiddenReason: text("hidden_reason"),
  },
  (table) => [
    index("posts_published_at_idx").on(table.publishedAt),
    index("posts_last_activity_at_idx").on(table.lastActivityAt),
    index("posts_author_published_idx").on(table.authorId, table.publishedAt),
    uniqueIndex("posts_author_creation_submission_unique").on(table.authorId, table.creationSubmissionKey),
  ],
);

export const replies = sqliteTable(
  "replies",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    authorId: text("author_id").notNull().references(() => users.id),
    rootReplyId: text("root_reply_id"),
    replyToReplyId: text("reply_to_reply_id"),
    replyToUserId: text("reply_to_user_id").references(() => users.id),
    submissionKey: text("submission_key"),
    markdown: text("markdown").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
    hiddenReason: text("hidden_reason"),
  },
  (table) => [
    index("replies_post_published_idx").on(table.postId, table.publishedAt),
    index("replies_root_reply_id_idx").on(table.rootReplyId),
    index("replies_reply_to_reply_id_idx").on(table.replyToReplyId),
    uniqueIndex("replies_author_submission_unique").on(table.authorId, table.submissionKey),
  ],
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id),
    authorId: text("author_id").references(() => users.id),
    contentMarkdown: text("content_markdown").notNull(),
    originalSelectedText: text("original_selected_text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdOnRevisionId: text("created_on_revision_id").notNull().references(() => postRevisions.id),
    submissionKey: text("submission_key").notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
    hiddenReason: text("hidden_reason"),
    anchorRetiredAt: integer("anchor_retired_at", { mode: "timestamp_ms" }),
    anchorRetiredByUserId: text("anchor_retired_by_user_id").references(() => users.id),
    anchorRetiredReason: text("anchor_retired_reason", { enum: ["POST_EDIT", "REVISION_RESTORE"] }),
    sourceType: text("source_type", { enum: ["NATIVE", "DOCX_IMPORT"] }).notNull().default("NATIVE"),
    sourceAuthorName: text("source_author_name"),
    sourceInitials: text("source_initials"),
    sourceCreatedAt: integer("source_created_at", { mode: "timestamp_ms" }),
    sourceCommentId: text("source_comment_id"),
    sourceDocumentOrder: integer("source_document_order"),
    sourceResolved: integer("source_resolved", { mode: "boolean" }),
    importBatchId: text("import_batch_id").references(() => importBatches.id),
    importedByUserId: text("imported_by_user_id").references(() => users.id),
    attributedUserId: text("attributed_user_id").references(() => users.id),
  },
  (table) => [
    index("annotations_post_created_idx").on(table.postId, table.createdAt),
    index("annotations_author_created_idx").on(table.authorId, table.createdAt),
    uniqueIndex("annotations_author_submission_unique").on(table.authorId, table.submissionKey),
    index("annotations_import_batch_idx").on(table.importBatchId),
    index("annotations_post_source_order_idx").on(table.postId, table.sourceType, table.sourceDocumentOrder),
    index("annotations_attributed_user_idx").on(table.attributedUserId),
    uniqueIndex("annotations_import_source_unique").on(table.importBatchId, table.sourceCommentId)
      .where(sql`${table.sourceType} = 'DOCX_IMPORT'`),
    check("annotations_source_type_check", sql`${table.sourceType} in ('NATIVE', 'DOCX_IMPORT')`),
    check("annotations_anchor_retirement_check", sql`
      (${table.anchorRetiredAt} is null and ${table.anchorRetiredByUserId} is null and ${table.anchorRetiredReason} is null)
      or
      (${table.anchorRetiredAt} is not null and ${table.anchorRetiredByUserId} is not null
        and ${table.anchorRetiredReason} in ('POST_EDIT', 'REVISION_RESTORE'))
    `),
    check("annotations_source_identity_check", sql`
      (${table.sourceType} = 'NATIVE'
        and ${table.authorId} is not null
        and ${table.sourceAuthorName} is null
        and ${table.sourceInitials} is null
        and ${table.sourceCreatedAt} is null
        and ${table.sourceCommentId} is null
        and ${table.sourceDocumentOrder} is null
        and ${table.sourceResolved} is null
        and ${table.importBatchId} is null
        and ${table.importedByUserId} is null
        and ${table.attributedUserId} is null)
      or
      (${table.sourceType} = 'DOCX_IMPORT'
        and ${table.authorId} is null
        and ${table.sourceAuthorName} is not null
        and ${table.sourceCommentId} is not null
        and ${table.sourceDocumentOrder} is not null
        and ${table.sourceDocumentOrder} >= 0
        and ${table.sourceResolved} is not null
        and ${table.sourceResolved} in (0, 1)
        and ${table.importBatchId} is not null
        and ${table.importedByUserId} is not null
        and ${table.submissionKey} = 'docx:' || ${table.importBatchId} || ':' || ${table.sourceCommentId})
    `),
  ],
);

export const annotationReplies = sqliteTable(
  "annotation_replies",
  {
    id: text("id").primaryKey(),
    annotationId: text("annotation_id").notNull().references(() => annotations.id),
    authorId: text("author_id").references(() => users.id),
    replyToUserId: text("reply_to_user_id").references(() => users.id),
    replyToReplyId: text("reply_to_reply_id"),
    contentMarkdown: text("content_markdown").notNull(),
    submissionKey: text("submission_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
    hiddenReason: text("hidden_reason"),
    sourceType: text("source_type", { enum: ["NATIVE", "DOCX_IMPORT"] }).notNull().default("NATIVE"),
    sourceAuthorName: text("source_author_name"),
    sourceInitials: text("source_initials"),
    sourceCreatedAt: integer("source_created_at", { mode: "timestamp_ms" }),
    sourceCommentId: text("source_comment_id"),
    sourceDocumentOrder: integer("source_document_order"),
    sourceResolved: integer("source_resolved", { mode: "boolean" }),
    importBatchId: text("import_batch_id").references(() => importBatches.id),
    importedByUserId: text("imported_by_user_id").references(() => users.id),
    attributedUserId: text("attributed_user_id").references(() => users.id),
  },
  (table) => [
    index("annotation_replies_annotation_created_idx").on(table.annotationId, table.createdAt),
    index("annotation_replies_reply_to_reply_idx").on(table.replyToReplyId),
    uniqueIndex("annotation_replies_author_submission_unique").on(table.authorId, table.submissionKey),
    index("annotation_replies_import_batch_idx").on(table.importBatchId),
    index("annotation_replies_annotation_source_order_idx").on(table.annotationId, table.sourceType, table.sourceDocumentOrder),
    index("annotation_replies_attributed_user_idx").on(table.attributedUserId),
    uniqueIndex("annotation_replies_import_source_unique").on(table.importBatchId, table.sourceCommentId)
      .where(sql`${table.sourceType} = 'DOCX_IMPORT'`),
    check("annotation_replies_source_type_check", sql`${table.sourceType} in ('NATIVE', 'DOCX_IMPORT')`),
    check("annotation_replies_source_identity_check", sql`
      (${table.sourceType} = 'NATIVE'
        and ${table.authorId} is not null
        and ${table.sourceAuthorName} is null
        and ${table.sourceInitials} is null
        and ${table.sourceCreatedAt} is null
        and ${table.sourceCommentId} is null
        and ${table.sourceDocumentOrder} is null
        and ${table.sourceResolved} is null
        and ${table.importBatchId} is null
        and ${table.importedByUserId} is null
        and ${table.attributedUserId} is null)
      or
      (${table.sourceType} = 'DOCX_IMPORT'
        and ${table.authorId} is null
        and ${table.sourceAuthorName} is not null
        and ${table.sourceCommentId} is not null
        and ${table.sourceDocumentOrder} is not null
        and ${table.sourceDocumentOrder} >= 0
        and ${table.sourceResolved} is not null
        and ${table.sourceResolved} in (0, 1)
        and ${table.importBatchId} is not null
        and ${table.importedByUserId} is not null
        and ${table.submissionKey} = 'docx:' || ${table.importBatchId} || ':' || ${table.sourceCommentId})
    `),
  ],
);

export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    adminUserId: text("admin_user_id").notNull().references(() => users.id),
    actionType: text("action_type", { enum: [
      "POST_HIDDEN",
      "POST_UNHIDDEN",
      "POST_RESTORED",
      "REPLY_HIDDEN",
      "REPLY_UNHIDDEN",
      "REPLY_RESTORED",
      "REVISION_RESTORED",
      "ANNOTATION_HIDDEN",
      "ANNOTATION_UNHIDDEN",
      "ANNOTATION_REPLY_HIDDEN",
      "ANNOTATION_REPLY_UNHIDDEN",
    ] }).notNull(),
    targetType: text("target_type", { enum: ["POST", "REPLY", "ANNOTATION", "ANNOTATION_REPLY"] }).notNull(),
    targetId: text("target_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    metadataJson: text("metadata_json"),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (table) => [
    uniqueIndex("admin_audit_log_dedupe_key_unique").on(table.dedupeKey),
    index("admin_audit_log_created_at_idx").on(table.createdAt),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull().references(() => users.id),
    eventType: text("event_type", { enum: ["POST_CREATED", "POST_REPLY_CREATED", "ANNOTATION_CREATED", "ANNOTATION_REPLY_CREATED"] }).notNull(),
    postId: text("post_id").notNull().references(() => posts.id),
    replyId: text("reply_id").references(() => replies.id),
    annotationId: text("annotation_id").references(() => annotations.id),
    annotationReplyId: text("annotation_reply_id").references(() => annotationReplies.id),
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
    notificationType: text("notification_type", { enum: ["POST_REPLY_RECEIVED", "POST_ANNOTATION_RECEIVED", "ANNOTATION_REPLY_RECEIVED", "DOCX_ATTRIBUTION_NOTICE"] }).notNull(),
    postId: text("post_id").notNull().references(() => posts.id),
    replyId: text("reply_id").references(() => replies.id),
    annotationId: text("annotation_id").references(() => annotations.id),
    annotationReplyId: text("annotation_reply_id").references(() => annotationReplies.id),
    metadataJson: text("metadata_json"),
    importBatchId: text("import_batch_id").references(() => importBatches.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
    index("notifications_recipient_read_created_idx").on(table.recipientUserId, table.readAt, table.createdAt),
    index("notifications_event_id_idx").on(table.eventId),
    index("notifications_import_batch_idx").on(table.importBatchId),
    uniqueIndex("notifications_event_recipient_type_unique").on(table.eventId, table.recipientUserId, table.notificationType),
    uniqueIndex("notifications_attribution_batch_unique").on(table.recipientUserId, table.importBatchId, table.notificationType)
      .where(sql`${table.notificationType} = 'DOCX_ATTRIBUTION_NOTICE'`),
    check("notifications_type_check", sql`${table.notificationType} in ('POST_REPLY_RECEIVED', 'POST_ANNOTATION_RECEIVED', 'ANNOTATION_REPLY_RECEIVED', 'DOCX_ATTRIBUTION_NOTICE')`),
    check("notifications_import_batch_check", sql`
      (${table.notificationType} = 'DOCX_ATTRIBUTION_NOTICE' and ${table.importBatchId} is not null and ${table.metadataJson} is not null)
      or (${table.notificationType} <> 'DOCX_ATTRIBUTION_NOTICE' and ${table.importBatchId} is null)
    `),
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
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    index("post_tags_tag_post_idx").on(table.tagId, table.postId),
  ],
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
    gcClaimedAt: integer("gc_claimed_at", { mode: "timestamp_ms" }),
    gcFailureCount: integer("gc_failure_count").notNull().default(0),
    gcLastFailedAt: integer("gc_last_failed_at", { mode: "timestamp_ms" }),
    gcLastErrorCode: text("gc_last_error_code", { enum: ["R2_UNAVAILABLE", "R2_DELETE_FAILED", "METADATA_UPDATE_FAILED"] }),
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
    kind: text("kind", { enum: ["CONTENT_EDIT", "RESTORE", "ANNOTATION_STATE"] }).notNull().default("CONTENT_EDIT"),
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

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    importerUserId: text("importer_user_id").notNull().references(() => users.id),
    sourceFilename: text("source_filename").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    postId: text("post_id").notNull().references(() => posts.id),
    revisionId: text("revision_id").notNull().references(() => postRevisions.id),
    committedAt: integer("committed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("import_batches_importer_committed_idx").on(table.importerUserId, table.committedAt),
    uniqueIndex("import_batches_post_unique").on(table.postId),
    uniqueIndex("import_batches_revision_unique").on(table.revisionId),
    check(
      "import_batches_source_sha256_check",
      sql`length(${table.sourceSha256}) = 64 and ${table.sourceSha256} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const postAnnotationAnchors = sqliteTable(
  "post_annotation_anchors",
  {
    postId: text("post_id").notNull().references(() => posts.id),
    annotationId: text("annotation_id").notNull().references(() => annotations.id),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.annotationId] }),
    index("post_annotation_anchors_annotation_idx").on(table.annotationId),
  ],
);

export const revisionAnnotationStates = sqliteTable(
  "revision_annotation_states",
  {
    revisionId: text("revision_id").notNull().references(() => postRevisions.id),
    annotationId: text("annotation_id").notNull().references(() => annotations.id),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.annotationId] }),
    index("revision_annotation_states_annotation_idx").on(table.annotationId),
  ],
);

export const revisionImportedReplyStates = sqliteTable(
  "revision_imported_reply_states",
  {
    revisionId: text("revision_id").notNull().references(() => postRevisions.id),
    annotationReplyId: text("annotation_reply_id").notNull().references(() => annotationReplies.id),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    hiddenByUserId: text("hidden_by_user_id").references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.annotationReplyId] }),
    index("revision_imported_reply_states_reply_idx").on(table.annotationReplyId),
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
export type AnnotationRecord = typeof annotations.$inferSelect;
export type AnnotationReplyRecord = typeof annotationReplies.$inferSelect;
export type ActivityEventRecord = typeof activityEvents.$inferSelect;
export type NotificationRecord = typeof notifications.$inferSelect;
export type AssetRecord = typeof assets.$inferSelect;
export type PostRevisionRecord = typeof postRevisions.$inferSelect;
export type PostAnnotationAnchorRecord = typeof postAnnotationAnchors.$inferSelect;
export type RevisionAnnotationStateRecord = typeof revisionAnnotationStates.$inferSelect;
export type ImportBatchRecord = typeof importBatches.$inferSelect;
export type RevisionImportedReplyStateRecord = typeof revisionImportedReplyStates.$inferSelect;
export type PostAssetRefRecord = typeof postAssetRefs.$inferSelect;
export type RevisionAssetRefRecord = typeof revisionAssetRefs.$inferSelect;
export type AdminAuditRecord = typeof adminAuditLog.$inferSelect;
