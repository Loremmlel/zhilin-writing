ALTER TABLE `posts` ADD `creation_submission_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_author_creation_submission_unique` ON `posts` (`author_id`,`creation_submission_key`);