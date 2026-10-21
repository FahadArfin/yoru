CREATE TABLE `reader_catalog_preferences` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`destination` text NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`, `destination`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
