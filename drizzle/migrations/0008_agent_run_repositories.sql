CREATE TABLE `agent_run_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`repo_url` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`branch_name` text,
	`pr_url` text,
	`pr_number` integer,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_repositories_run_repo_idx` ON `agent_run_repositories` (`agent_run_id`,`repo_url`);
--> statement-breakpoint
INSERT INTO `agent_run_repositories` (`id`, `agent_run_id`, `repo_url`, `position`, `status`, `branch_name`, `pr_url`, `pr_number`, `error_message`, `created_at`, `updated_at`)
SELECT 'legacy-' || `id`, `id`, `repo_url`, 0,
	CASE
		WHEN `status` = 'merged' THEN 'merged'
		WHEN `status` = 'closed' THEN 'closed'
		WHEN `pr_url` IS NOT NULL THEN 'success'
		ELSE 'pending'
	END,
	`branch_name`, `pr_url`, `pr_number`, `error_message`, `created_at`, `updated_at`
FROM `agent_runs`
WHERE `repo_url` IS NOT NULL AND trim(`repo_url`) <> '';
