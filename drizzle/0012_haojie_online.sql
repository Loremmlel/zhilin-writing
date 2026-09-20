CREATE TABLE `haojie_requests` (
	`room_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `actor_id`, `request_id`),
	FOREIGN KEY (`room_id`) REFERENCES `haojie_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `haojie_requests_actor_time_idx` ON `haojie_requests` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `haojie_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`player1_id` text NOT NULL,
	`player2_id` text,
	`creation_request_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state_json` text,
	`engine_version` text NOT NULL,
	`ruleset` text NOT NULL,
	`view_version` integer NOT NULL,
	`last_change` text NOT NULL,
	`winner` text,
	`end_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player1_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player2_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "haojie_rooms_distinct_players" CHECK("haojie_rooms"."player2_id" IS NULL OR "haojie_rooms"."player2_id" != "haojie_rooms"."player1_id"),
	CONSTRAINT "haojie_rooms_revision_valid" CHECK("haojie_rooms"."revision" >= 0),
	CONSTRAINT "haojie_rooms_lifecycle_valid" CHECK(("haojie_rooms"."status" IN ('waiting', 'cancelled') AND "haojie_rooms"."player2_id" IS NULL AND "haojie_rooms"."state_json" IS NULL) OR ("haojie_rooms"."status" IN ('playing', 'finished') AND "haojie_rooms"."player2_id" IS NOT NULL AND "haojie_rooms"."state_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `haojie_rooms_creation_unique` ON `haojie_rooms` (`player1_id`,`creation_request_id`);--> statement-breakpoint
CREATE INDEX `haojie_rooms_player1_status_idx` ON `haojie_rooms` (`player1_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `haojie_rooms_player2_status_idx` ON `haojie_rooms` (`player2_id`,`status`,`updated_at`);