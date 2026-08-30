CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`importer_user_id` text NOT NULL,
	`source_filename` text NOT NULL,
	`source_sha256` text NOT NULL,
	`post_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`committed_at` integer NOT NULL,
	FOREIGN KEY (`importer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_batches_source_sha256_check" CHECK(length("import_batches"."source_sha256") = 64 and "import_batches"."source_sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `import_batches_importer_committed_idx` ON `import_batches` (`importer_user_id`,`committed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_post_unique` ON `import_batches` (`post_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_revision_unique` ON `import_batches` (`revision_id`);--> statement-breakpoint
CREATE TABLE `revision_imported_reply_states` (
	`revision_id` text NOT NULL,
	`annotation_reply_id` text NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`hidden_at` integer,
	`hidden_by_user_id` text,
	PRIMARY KEY(`revision_id`, `annotation_reply_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annotation_reply_id`) REFERENCES `annotation_replies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `revision_imported_reply_states_reply_idx` ON `revision_imported_reply_states` (`annotation_reply_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_annotation_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`author_id` text,
	`reply_to_user_id` text,
	`reply_to_reply_id` text,
	`content_markdown` text NOT NULL,
	`submission_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`hidden_at` integer,
	`hidden_by_user_id` text,
	`hidden_reason` text,
	`source_type` text DEFAULT 'NATIVE' NOT NULL,
	`source_author_name` text,
	`source_initials` text,
	`source_created_at` integer,
	`source_comment_id` text,
	`source_document_order` integer,
	`source_resolved` integer,
	`import_batch_id` text,
	`imported_by_user_id` text,
	`attributed_user_id` text,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attributed_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotation_replies_source_type_check" CHECK("__new_annotation_replies"."source_type" in ('NATIVE', 'DOCX_IMPORT')),
	CONSTRAINT "annotation_replies_source_identity_check" CHECK(
      ("__new_annotation_replies"."source_type" = 'NATIVE'
        and "__new_annotation_replies"."author_id" is not null
        and "__new_annotation_replies"."source_author_name" is null
        and "__new_annotation_replies"."source_initials" is null
        and "__new_annotation_replies"."source_created_at" is null
        and "__new_annotation_replies"."source_comment_id" is null
        and "__new_annotation_replies"."source_document_order" is null
        and "__new_annotation_replies"."source_resolved" is null
        and "__new_annotation_replies"."import_batch_id" is null
        and "__new_annotation_replies"."imported_by_user_id" is null
        and "__new_annotation_replies"."attributed_user_id" is null)
      or
      ("__new_annotation_replies"."source_type" = 'DOCX_IMPORT'
        and "__new_annotation_replies"."author_id" is null
        and "__new_annotation_replies"."source_author_name" is not null
        and "__new_annotation_replies"."source_comment_id" is not null
        and "__new_annotation_replies"."source_document_order" is not null
        and "__new_annotation_replies"."source_document_order" >= 0
        and "__new_annotation_replies"."source_resolved" is not null
        and "__new_annotation_replies"."source_resolved" in (0, 1)
        and "__new_annotation_replies"."import_batch_id" is not null
        and "__new_annotation_replies"."imported_by_user_id" is not null
        and "__new_annotation_replies"."submission_key" = 'docx:' || "__new_annotation_replies"."import_batch_id" || ':' || "__new_annotation_replies"."source_comment_id")
    )
);
--> statement-breakpoint
INSERT INTO `__new_annotation_replies`("id", "annotation_id", "author_id", "reply_to_user_id", "reply_to_reply_id", "content_markdown", "submission_key", "created_at", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", "source_type", "source_author_name", "source_initials", "source_created_at", "source_comment_id", "source_document_order", "source_resolved", "import_batch_id", "imported_by_user_id", "attributed_user_id") SELECT "id", "annotation_id", "author_id", "reply_to_user_id", "reply_to_reply_id", "content_markdown", "submission_key", "created_at", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", 'NATIVE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM `annotation_replies`;--> statement-breakpoint
DROP TABLE `annotation_replies`;--> statement-breakpoint
ALTER TABLE `__new_annotation_replies` RENAME TO `annotation_replies`;--> statement-breakpoint
CREATE INDEX `annotation_replies_annotation_created_idx` ON `annotation_replies` (`annotation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotation_replies_reply_to_reply_idx` ON `annotation_replies` (`reply_to_reply_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_replies_author_submission_unique` ON `annotation_replies` (`author_id`,`submission_key`);--> statement-breakpoint
CREATE INDEX `annotation_replies_import_batch_idx` ON `annotation_replies` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `annotation_replies_annotation_source_order_idx` ON `annotation_replies` (`annotation_id`,`source_type`,`source_document_order`);--> statement-breakpoint
CREATE INDEX `annotation_replies_attributed_user_idx` ON `annotation_replies` (`attributed_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_replies_import_source_unique` ON `annotation_replies` (`import_batch_id`,`source_comment_id`) WHERE "annotation_replies"."source_type" = 'DOCX_IMPORT';--> statement-breakpoint
CREATE TABLE `__new_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text,
	`content_markdown` text NOT NULL,
	`original_selected_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_on_revision_id` text NOT NULL,
	`submission_key` text NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`hidden_at` integer,
	`hidden_by_user_id` text,
	`hidden_reason` text,
	`source_type` text DEFAULT 'NATIVE' NOT NULL,
	`source_author_name` text,
	`source_initials` text,
	`source_created_at` integer,
	`source_comment_id` text,
	`source_document_order` integer,
	`source_resolved` integer,
	`import_batch_id` text,
	`imported_by_user_id` text,
	`attributed_user_id` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_on_revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attributed_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotations_source_type_check" CHECK("__new_annotations"."source_type" in ('NATIVE', 'DOCX_IMPORT')),
	CONSTRAINT "annotations_source_identity_check" CHECK(
      ("__new_annotations"."source_type" = 'NATIVE'
        and "__new_annotations"."author_id" is not null
        and "__new_annotations"."source_author_name" is null
        and "__new_annotations"."source_initials" is null
        and "__new_annotations"."source_created_at" is null
        and "__new_annotations"."source_comment_id" is null
        and "__new_annotations"."source_document_order" is null
        and "__new_annotations"."source_resolved" is null
        and "__new_annotations"."import_batch_id" is null
        and "__new_annotations"."imported_by_user_id" is null
        and "__new_annotations"."attributed_user_id" is null)
      or
      ("__new_annotations"."source_type" = 'DOCX_IMPORT'
        and "__new_annotations"."author_id" is null
        and "__new_annotations"."source_author_name" is not null
        and "__new_annotations"."source_comment_id" is not null
        and "__new_annotations"."source_document_order" is not null
        and "__new_annotations"."source_document_order" >= 0
        and "__new_annotations"."source_resolved" is not null
        and "__new_annotations"."source_resolved" in (0, 1)
        and "__new_annotations"."import_batch_id" is not null
        and "__new_annotations"."imported_by_user_id" is not null
        and "__new_annotations"."submission_key" = 'docx:' || "__new_annotations"."import_batch_id" || ':' || "__new_annotations"."source_comment_id")
    )
);
--> statement-breakpoint
INSERT INTO `__new_annotations`("id", "post_id", "author_id", "content_markdown", "original_selected_text", "created_at", "created_on_revision_id", "submission_key", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", "source_type", "source_author_name", "source_initials", "source_created_at", "source_comment_id", "source_document_order", "source_resolved", "import_batch_id", "imported_by_user_id", "attributed_user_id") SELECT "id", "post_id", "author_id", "content_markdown", "original_selected_text", "created_at", "created_on_revision_id", "submission_key", "deleted_at", "deleted_by_user_id", "hidden_at", "hidden_by_user_id", "hidden_reason", 'NATIVE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM `annotations`;--> statement-breakpoint
DROP TABLE `annotations`;--> statement-breakpoint
ALTER TABLE `__new_annotations` RENAME TO `annotations`;--> statement-breakpoint
CREATE INDEX `annotations_post_created_idx` ON `annotations` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotations_author_created_idx` ON `annotations` (`author_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_author_submission_unique` ON `annotations` (`author_id`,`submission_key`);--> statement-breakpoint
CREATE INDEX `annotations_import_batch_idx` ON `annotations` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `annotations_post_source_order_idx` ON `annotations` (`post_id`,`source_type`,`source_document_order`);--> statement-breakpoint
CREATE INDEX `annotations_attributed_user_idx` ON `annotations` (`attributed_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_import_source_unique` ON `annotations` (`import_batch_id`,`source_comment_id`) WHERE "annotations"."source_type" = 'DOCX_IMPORT';--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`post_id` text NOT NULL,
	`reply_id` text,
	`annotation_id` text,
	`annotation_reply_id` text,
	`metadata_json` text,
	`import_batch_id` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `activity_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annotation_reply_id`) REFERENCES `annotation_replies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_type_check" CHECK("__new_notifications"."notification_type" in ('POST_REPLY_RECEIVED', 'POST_ANNOTATION_RECEIVED', 'ANNOTATION_REPLY_RECEIVED', 'DOCX_ATTRIBUTION_NOTICE')),
	CONSTRAINT "notifications_import_batch_check" CHECK(
      ("__new_notifications"."notification_type" = 'DOCX_ATTRIBUTION_NOTICE' and "__new_notifications"."import_batch_id" is not null and "__new_notifications"."metadata_json" is not null)
      or ("__new_notifications"."notification_type" <> 'DOCX_ATTRIBUTION_NOTICE' and "__new_notifications"."import_batch_id" is null)
    )
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "recipient_user_id", "actor_user_id", "event_id", "notification_type", "post_id", "reply_id", "annotation_id", "annotation_reply_id", "metadata_json", "import_batch_id", "created_at", "read_at") SELECT "id", "recipient_user_id", "actor_user_id", "event_id", "notification_type", "post_id", "reply_id", "annotation_id", "annotation_reply_id", NULL, NULL, "created_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
CREATE INDEX `notifications_recipient_created_idx` ON `notifications` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_read_created_idx` ON `notifications` (`recipient_user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_event_id_idx` ON `notifications` (`event_id`);--> statement-breakpoint
CREATE INDEX `notifications_import_batch_idx` ON `notifications` (`import_batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_recipient_type_unique` ON `notifications` (`event_id`,`recipient_user_id`,`notification_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_attribution_batch_unique` ON `notifications` (`recipient_user_id`,`import_batch_id`,`notification_type`) WHERE "notifications"."notification_type" = 'DOCX_ATTRIBUTION_NOTICE';--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
