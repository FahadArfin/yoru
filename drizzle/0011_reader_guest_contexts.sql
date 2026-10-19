CREATE TABLE `reader_guest_contexts` (
	`guest_hash` text NOT NULL,
	`destination` text NOT NULL,
	`selection` text NOT NULL,
	`revision` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`guest_hash`, `destination`)
);
--> statement-breakpoint
CREATE INDEX `reader_guest_contexts_expiry` ON `reader_guest_contexts` (`expires_at`);