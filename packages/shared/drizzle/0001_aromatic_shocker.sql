CREATE TABLE `thread_connections` (
	`agent_name` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`thread_ts` text NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_connections_thread_ts_unique` ON `thread_connections` (`thread_ts`);