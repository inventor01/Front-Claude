CREATE TABLE `narrative_relationships` (
	`owner` text NOT NULL,
	`narrative` text NOT NULL,
	`related_key` text NOT NULL,
	`related_title` text NOT NULL,
	`relation` text NOT NULL,
	`score` real NOT NULL,
	`evidence_count` integer NOT NULL,
	`author_count` integer NOT NULL,
	`platforms` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`observed` integer NOT NULL,
	PRIMARY KEY(`owner`, `narrative`, `related_key`)
);