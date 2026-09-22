CREATE TABLE `haojie_history` (
	`room_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`room_id`, `revision`),
	FOREIGN KEY (`room_id`) REFERENCES `haojie_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `haojie_rooms` ADD `undo_json` text;