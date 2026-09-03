ALTER TABLE `assets` ADD `gc_claimed_at` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `gc_failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `gc_last_failed_at` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `gc_last_error_code` text;