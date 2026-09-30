CREATE TABLE IF NOT EXISTS `agent_scroll_evidence` (
	`owner` text NOT NULL,
	`job_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`platform` text NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`owner`, `job_id`, `evidence_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_scroll_jobs` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`caller` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'QUEUED' NOT NULL,
	`request_json` text NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`bridge_id` text,
	`scan_id` text,
	`observed_count` integer DEFAULT 0 NOT NULL,
	`platform_counts` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`limitations` text DEFAULT '[]' NOT NULL,
	`error` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`started` integer,
	`heartbeat` integer,
	`completed` integer,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bridge_agents` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`last_seen` integer NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
