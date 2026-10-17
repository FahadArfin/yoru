CREATE TABLE `chapter_opens` (
	`media_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`opened_at` integer NOT NULL,
	PRIMARY KEY(`media_id`, `chapter_id`, `visitor_hash`)
);
--> statement-breakpoint
CREATE TABLE `chapter_ratings` (
	`media_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rating` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`media_id`, `chapter_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chapter_rating_range" CHECK("chapter_ratings"."rating" BETWEEN 1 AND 5)
);
