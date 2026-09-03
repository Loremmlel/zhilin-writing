DROP INDEX `posts_author_id_idx`;--> statement-breakpoint
CREATE INDEX `posts_author_published_idx` ON `posts` (`author_id`,`published_at`);--> statement-breakpoint
DROP INDEX `replies_post_id_idx`;--> statement-breakpoint
CREATE INDEX `replies_post_published_idx` ON `replies` (`post_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `post_tags_tag_post_idx` ON `post_tags` (`tag_id`,`post_id`);