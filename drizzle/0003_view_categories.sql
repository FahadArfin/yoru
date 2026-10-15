ALTER TABLE `watch_views` ADD `category` text DEFAULT 'ANIME' NOT NULL;--> statement-breakpoint
UPDATE `watch_views` SET `category` = 'MANGA' WHERE `media_id` LIKE 'mal-manga-%';--> statement-breakpoint
CREATE INDEX `watch_views_category_expiry` ON `watch_views` (`category`,`last_seen`);
