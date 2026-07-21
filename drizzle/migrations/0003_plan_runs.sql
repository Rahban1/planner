ALTER TABLE `agent_runs` ADD `kind` text DEFAULT 'implement' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `plan_md` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `plan_feedback` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `plan_version` integer DEFAULT 1 NOT NULL;