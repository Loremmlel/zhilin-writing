CREATE TABLE `post_asset_refs` (
	`post_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`usage` text NOT NULL,
	PRIMARY KEY(`post_id`, `asset_id`, `usage`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_asset_refs_asset_idx` ON `post_asset_refs` (`asset_id`);--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`restore_source_revision_id` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_revisions_post_number_unique` ON `post_revisions` (`post_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `post_revisions_post_created_idx` ON `post_revisions` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `revision_asset_refs` (
	`revision_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`usage` text NOT NULL,
	PRIMARY KEY(`revision_id`, `asset_id`, `usage`),
	FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `revision_asset_refs_asset_idx` ON `revision_asset_refs` (`asset_id`);--> statement-breakpoint
ALTER TABLE `posts` ADD `current_revision_id` text;--> statement-breakpoint
INSERT INTO `post_revisions` (
	`id`, `post_id`, `revision_number`, `title`, `markdown`, `created_at`, `created_by_user_id`, `restore_source_revision_id`
)
SELECT
	'revision:' || `posts`.`id` || ':1',
	`posts`.`id`,
	1,
	`posts`.`title`,
	`posts`.`markdown`,
	`posts`.`published_at`,
	`posts`.`author_id`,
	NULL
FROM `posts`
WHERE NOT EXISTS (
	SELECT 1 FROM `post_revisions` WHERE `post_revisions`.`post_id` = `posts`.`id`
);--> statement-breakpoint
INSERT OR IGNORE INTO `post_asset_refs` (`post_id`, `asset_id`, `usage`)
SELECT
	`assets`.`post_id`,
	`assets`.`id`,
	CASE WHEN `assets`.`kind` = 'attachment' THEN 'attachment' ELSE 'inline' END
FROM `assets`
WHERE `assets`.`post_id` IS NOT NULL
	AND `assets`.`deleted_at` IS NULL
	AND `assets`.`kind` IN ('image', 'attachment');--> statement-breakpoint
INSERT OR IGNORE INTO `revision_asset_refs` (`revision_id`, `asset_id`, `usage`)
SELECT
	'revision:' || `post_asset_refs`.`post_id` || ':1',
	`post_asset_refs`.`asset_id`,
	`post_asset_refs`.`usage`
FROM `post_asset_refs`;--> statement-breakpoint
UPDATE `posts`
SET `current_revision_id` = 'revision:' || `posts`.`id` || ':1'
WHERE `current_revision_id` IS NULL;
