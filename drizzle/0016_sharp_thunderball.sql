CREATE TABLE `haojie_records` (
	`room_id` text NOT NULL,
	`revision` integer NOT NULL,
	`record_json` text NOT NULL,
	PRIMARY KEY(`room_id`, `revision`),
	FOREIGN KEY (`room_id`) REFERENCES `haojie_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `haojie_rooms` ADD `recording_complete` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `haojie_rooms` ADD `archive_key` text;--> statement-breakpoint
ALTER TABLE `haojie_rooms` ADD `archive_bytes` integer;--> statement-breakpoint
ALTER TABLE `haojie_rooms` ADD `archived_at` integer;--> statement-breakpoint
-- Preserve surviving legacy snapshots before the undo stack can change again.
INSERT INTO haojie_records (room_id, revision, record_json)
SELECT room_id, revision - 1, json_object('revision', revision - 1, 'kind', 'legacy-snapshot',
  'createdAt', NULL, 'state', json(state_json)) FROM haojie_history;
--> statement-breakpoint
INSERT INTO haojie_records (room_id, revision, record_json)
SELECT id, revision, json_object('revision', revision, 'kind', 'legacy-baseline', 'createdAt', updated_at,
  'state', json(state_json), 'status', status, 'winner', winner, 'endReason', end_reason) FROM haojie_rooms;
