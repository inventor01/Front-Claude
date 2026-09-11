PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`mint` text NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`quantity` real NOT NULL,
	`entry` real NOT NULL,
	`opened` integer NOT NULL,
	`exit` real,
	`closed` integer,
	`proceeds` real,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_trades`("id", "owner", "mint", "name", "amount", "quantity", "entry", "opened", "exit", "closed", "proceeds") SELECT "id", "owner", "mint", "name", "amount", "quantity", "entry", "opened", "exit", "closed", "proceeds" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
PRAGMA foreign_keys=ON;