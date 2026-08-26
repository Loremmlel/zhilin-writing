CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`metadata_json` text,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_audit_log_dedupe_key_unique` ON `admin_audit_log` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_at_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_target_idx` ON `admin_audit_log` (`target_type`,`target_id`);--> statement-breakpoint
ALTER TABLE `posts` ADD `deleted_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `posts` ADD `hidden_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `posts` ADD `hidden_reason` text;--> statement-breakpoint
ALTER TABLE `replies` ADD `reply_to_reply_id` text;--> statement-breakpoint
ALTER TABLE `replies` ADD `deleted_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `replies` ADD `hidden_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `replies` ADD `hidden_reason` text;--> statement-breakpoint
UPDATE `replies` AS `child`
SET `reply_to_reply_id` = (
	SELECT `candidate`.`id`
	FROM `replies` AS `candidate`
	WHERE `candidate`.`post_id` = `child`.`post_id`
		AND `candidate`.`published_at` < `child`.`published_at`
		AND `candidate`.`author_id` = `child`.`reply_to_user_id`
		AND (`candidate`.`id` = `child`.`root_reply_id` OR `candidate`.`root_reply_id` = `child`.`root_reply_id`)
	ORDER BY `candidate`.`published_at` DESC, `candidate`.`id` DESC
	LIMIT 1
)
WHERE `child`.`root_reply_id` IS NOT NULL
	AND `child`.`reply_to_user_id` IS NOT NULL
	AND `child`.`reply_to_reply_id` IS NULL;--> statement-breakpoint
CREATE INDEX `replies_reply_to_reply_id_idx` ON `replies` (`reply_to_reply_id`);
