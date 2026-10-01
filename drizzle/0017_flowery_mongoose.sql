CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_expiry_idx` ON `login_attempts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `member_passwords` (
	`allowed_user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	FOREIGN KEY (`allowed_user_id`) REFERENCES `allowed_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`allowed_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`allowed_user_id`) REFERENCES `member_passwords`(`allowed_user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_sessions_member_idx` ON `member_sessions` (`allowed_user_id`);--> statement-breakpoint
CREATE INDEX `member_sessions_expiry_idx` ON `member_sessions` (`expires_at`);