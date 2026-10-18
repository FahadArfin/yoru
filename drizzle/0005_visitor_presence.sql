CREATE TABLE `visitor_presence` (
	`visitor_hash` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_hash` text,
	`activity` text NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_hash`) REFERENCES `sessions`(`token_hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visitor_presence_seen` ON `visitor_presence` (`last_seen`);