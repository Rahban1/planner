ALTER TABLE `agent_runs` ADD `source_run_id` text;
ALTER TABLE `projects` ADD `instructions` text;
CREATE INDEX `agent_runs_source_run_idx` ON `agent_runs` (`source_run_id`);
CREATE INDEX `agent_runs_task_created_idx` ON `agent_runs` (`task_id`, `created_at`);
CREATE TABLE IF NOT EXISTS `plan_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_run_id` text NOT NULL REFERENCES `agent_runs` (`id`) ON DELETE CASCADE,
  `version` integer NOT NULL,
  `markdown` text NOT NULL,
  `created_at` integer NOT NULL
);
ALTER TABLE `plan_revisions` ADD `feedback` text;
CREATE UNIQUE INDEX IF NOT EXISTS `plan_revisions_run_version_idx` ON `plan_revisions` (`agent_run_id`, `version`);
INSERT OR IGNORE INTO `plan_revisions` (`id`, `agent_run_id`, `version`, `markdown`, `feedback`, `created_at`)
SELECT 'initial-' || `id`, `id`, `plan_version`, `plan_md`, `plan_feedback`, `updated_at`
FROM `agent_runs` WHERE `kind` = 'plan' AND `plan_md` IS NOT NULL;
