ALTER TABLE `comments` ADD `edition_id` text;--> statement-breakpoint
CREATE INDEX `comments_media_edition` ON `comments` (`media_id`,`edition_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `destination` text DEFAULT 'yoru' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `reader_source_id` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `reader_edition_id` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `reader_provenance` text;--> statement-breakpoint
CREATE INDEX `rooms_destination_open` ON `rooms` (`destination`,`closed_at`);