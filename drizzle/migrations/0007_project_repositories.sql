CREATE TABLE `project_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_repositories_project_url_idx` ON `project_repositories` (`project_id`,`url`);
--> statement-breakpoint
INSERT INTO `project_repositories` (`id`, `project_id`, `url`, `position`, `created_at`)
SELECT 'legacy-' || `id`, `id`, `repo_url`, 0, `created_at`
FROM `projects`
WHERE `repo_url` IS NOT NULL AND trim(`repo_url`) <> '';
