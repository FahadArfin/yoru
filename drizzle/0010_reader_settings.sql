CREATE TABLE `reader_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`modes` text DEFAULT '{"yoru":"all","ara-ara":"all"}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
