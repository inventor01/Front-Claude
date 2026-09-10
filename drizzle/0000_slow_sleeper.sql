CREATE TABLE `cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`accounts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`quantity` real NOT NULL,
	`entry` real NOT NULL,
	`opened` integer NOT NULL,
	`exit` real,
	`closed` integer,
	`proceeds` real
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`owner` text NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`owner`, `mint`)
);
