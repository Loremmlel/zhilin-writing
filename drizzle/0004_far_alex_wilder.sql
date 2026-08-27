CREATE TABLE `annotation_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`author_id` text NOT NULL,
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
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `annotation_replies_annotation_created_idx` ON `annotation_replies` (`annotation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotation_replies_reply_to_reply_idx` ON `annotation_replies` (`reply_to_reply_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_replies_author_submission_unique` ON `annotation_replies` (`author_id`,`submission_key`);--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
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
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_on_revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `annotations_post_created_idx` ON `annotations` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotations_author_created_idx` ON `annotations` (`author_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_author_submission_unique` ON `annotations` (`author_id`,`submission_key`);--> statement-breakpoint
CREATE TABLE `post_annotation_anchors` (
	`post_id` text NOT NULL,
	`annotation_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `annotation_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_annotation_anchors_annotation_idx` ON `post_annotation_anchors` (`annotation_id`);--> statement-breakpoint
CREATE TABLE `revision_annotation_states` (
	`revision_id` text NOT NULL,
	`annotation_id` text NOT NULL,
	`deleted_at` integer,
	`deleted_by_user_id` text,
	`hidden_at` integer,
	`hidden_by_user_id` text,
	PRIMARY KEY(`revision_id`, `annotation_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `revision_annotation_states_annotation_idx` ON `revision_annotation_states` (`annotation_id`);--> statement-breakpoint
ALTER TABLE `activity_events` ADD `annotation_id` text REFERENCES annotations(id);--> statement-breakpoint
ALTER TABLE `activity_events` ADD `annotation_reply_id` text REFERENCES annotation_replies(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `annotation_id` text REFERENCES annotations(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `annotation_reply_id` text REFERENCES annotation_replies(id);--> statement-breakpoint
ALTER TABLE `post_revisions` ADD `kind` text DEFAULT 'CONTENT_EDIT' NOT NULL;