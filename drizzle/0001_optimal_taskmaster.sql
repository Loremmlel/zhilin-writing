CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`post_id` text NOT NULL,
	`reply_id` text,
	`root_reply_id` text,
	`reply_to_user_id` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`invalidated_at` integer,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_events_actor_created_idx` ON `activity_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_post_created_idx` ON `activity_events` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_type_created_idx` ON `activity_events` (`event_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`post_id` text NOT NULL,
	`reply_id` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `activity_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_created_idx` ON `notifications` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_read_created_idx` ON `notifications` (`recipient_user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_event_id_idx` ON `notifications` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_recipient_type_unique` ON `notifications` (`event_id`,`recipient_user_id`,`notification_type`);--> statement-breakpoint
ALTER TABLE `replies` ADD `submission_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `replies_author_submission_unique` ON `replies` (`author_id`,`submission_key`);