CREATE TABLE `db_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`file_mtime` integer,
	`recall_count` integer DEFAULT 0 NOT NULL,
	`last_recalled_at` text
);
--> statement-breakpoint
CREATE TABLE `transcript_index` (
	`session_id` text NOT NULL,
	`encoded_cwd` text NOT NULL,
	`file_path` text NOT NULL,
	`first_timestamp` text,
	`last_timestamp` text,
	`turn_count` integer,
	`file_size_bytes` integer,
	`file_mtime` integer,
	`indexed_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `encoded_cwd`)
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` text NOT NULL,
	`channel_id` text DEFAULT '' NOT NULL,
	`session_type` text NOT NULL,
	`session_id` text NOT NULL,
	`agent_name` text,
	`model` text,
	`cost_usd` real,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`turn_number` integer,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `usage_session_timestamp` ON `usage` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `usage_channel_type` ON `usage` (`channel_id`,`session_type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `usage_agent_timestamp` ON `usage` (`agent_name`,`timestamp`);--> statement-breakpoint
CREATE INDEX `usage_timestamp` ON `usage` (`timestamp`);