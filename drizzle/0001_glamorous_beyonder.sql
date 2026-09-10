CREATE TABLE `collector` (
	`owner` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`lock_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`platform` text NOT NULL,
	`author` text NOT NULL,
	`url` text NOT NULL,
	`content` text NOT NULL,
	`published` integer,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`provenance` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_links` (
	`owner` text NOT NULL,
	`narrative` text NOT NULL,
	`evidence` text NOT NULL,
	`reason` text NOT NULL,
	PRIMARY KEY(`owner`, `narrative`, `evidence`)
);
--> statement-breakpoint
CREATE TABLE `narrative_coins` (
	`owner` text NOT NULL,
	`narrative` text NOT NULL,
	`mint` text NOT NULL,
	`data` text NOT NULL,
	`observed` integer NOT NULL,
	PRIMARY KEY(`owner`, `narrative`, `mint`)
);
--> statement-breakpoint
CREATE TABLE `narratives` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`aliases` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`observed` integer NOT NULL,
	`views` integer,
	`likes` integer,
	PRIMARY KEY(`owner`, `id`, `observed`)
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`owner` text NOT NULL,
	`day` text NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `day`)
);
