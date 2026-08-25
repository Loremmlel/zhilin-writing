CREATE TABLE `allowed_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	`added_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allowed_users_email_unique` ON `allowed_users` (`email`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`post_id` text,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'temporary' NOT NULL,
	`created_at` integer NOT NULL,
	`bound_at` integer,
	`expires_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_r2_key_unique` ON `assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `assets_owner_status_idx` ON `assets` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `assets_post_id_idx` ON `assets` (`post_id`);--> statement-breakpoint
CREATE INDEX `assets_expires_at_idx` ON `assets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`published_at` integer NOT NULL,
	`edited_at` integer,
	`last_activity_at` integer NOT NULL,
	`deleted_at` integer,
	`hidden_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_published_at_idx` ON `posts` (`published_at`);--> statement-breakpoint
CREATE INDEX `posts_last_activity_at_idx` ON `posts` (`last_activity_at`);--> statement-breakpoint
CREATE INDEX `posts_author_id_idx` ON `posts` (`author_id`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`root_reply_id` text,
	`reply_to_user_id` text,
	`markdown` text NOT NULL,
	`published_at` integer NOT NULL,
	`deleted_at` integer,
	`hidden_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `replies_post_id_idx` ON `replies` (`post_id`);--> statement-breakpoint
CREATE INDEX `replies_root_reply_id_idx` ON `replies` (`root_reply_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_unique` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email_key` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_asset_id` text,
	`bio` text DEFAULT '' NOT NULL,
	`joined_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_key_unique` ON `users` (`email_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_display_name_unique` ON `users` (`display_name`);