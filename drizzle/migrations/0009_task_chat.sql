ALTER TABLE `tasks` ADD `owner_user_id` text;
ALTER TABLE `tasks` ADD `lifecycle_state` text NOT NULL DEFAULT 'discussion';
ALTER TABLE `tasks` ADD `last_message_at` integer;
ALTER TABLE `tasks` ADD `next_action` text;
ALTER TABLE `agent_runs` ADD `trigger_message_id` text;
ALTER TABLE `agent_runs` ADD `confirmation_message_id` text;
ALTER TABLE `agent_runs` ADD `approved_by_user_id` text;
--> statement-breakpoint
CREATE TABLE `task_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_user_id` text,
	`kind` text DEFAULT 'text' NOT NULL,
	`body` text NOT NULL,
	`metadata` text,
	`client_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_messages_task_created_idx` ON `task_messages` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `task_messages_task_id_idx` ON `task_messages` (`task_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_messages_client_message_idx` ON `task_messages` (`task_id`,`client_message_id`);
--> statement-breakpoint
CREATE TABLE `task_message_reads` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_message_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_message_reads_task_user_idx` ON `task_message_reads` (`task_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `project_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_invites_token_hash_unique` ON `project_invites` (`token_hash`);
