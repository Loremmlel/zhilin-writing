ALTER TABLE `annotations` ADD `anchor_retired_at` integer;--> statement-breakpoint
ALTER TABLE `annotations` ADD `anchor_retired_by_user_id` text REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `annotations` ADD `anchor_retired_reason` text CHECK (
  (`anchor_retired_at` is null and `anchor_retired_by_user_id` is null and `anchor_retired_reason` is null)
  or
  (`anchor_retired_at` is not null and `anchor_retired_by_user_id` is not null
    and `anchor_retired_reason` in ('POST_EDIT', 'REVISION_RESTORE'))
);
