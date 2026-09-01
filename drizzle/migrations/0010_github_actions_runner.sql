ALTER TABLE `agent_runs` ADD `runner_backend` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runner_job_id` text;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `runner_job_url` text;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `dispatch_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `dispatched_at` integer;
