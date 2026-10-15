CREATE TABLE `watch_views` (
	`media_id` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`media_id`, `visitor_hash`)
);
--> statement-breakpoint
CREATE INDEX `watch_views_expiry` ON `watch_views` (`last_seen`);