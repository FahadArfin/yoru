CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`unit` integer DEFAULT 0 NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_media_unit` ON `comments` (`media_id`,`unit`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`room_id` text,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_expiry` ON `event_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `imported_media` (
	`media_id` text PRIMARY KEY NOT NULL,
	`metadata` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library` (
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`score` real,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `media_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mal_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mal_user_id` text NOT NULL,
	`username` text NOT NULL,
	`tokens_cipher` text NOT NULL,
	`connection_version` text NOT NULL,
	`connected_at` text NOT NULL,
	`last_synced_at` text,
	`sync_claim` text,
	`sync_expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mal_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claim` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_members_expiry` ON `room_members` (`last_seen`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`room_id` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_room_time` ON `messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`user_id` text,
	`session_hash` text
);
--> statement-breakpoint
CREATE TABLE `presence_leases` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`room_id` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`session_hash`) REFERENCES `sessions`(`token_hash`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `presence_expiry` ON `presence_leases` (`expires_at`);--> statement-breakpoint
CREATE INDEX `presence_user_room` ON `presence_leases` (`user_id`,`room_id`);--> statement-breakpoint
CREATE TABLE `favorite_previews` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`items` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claim` text,
	FOREIGN KEY (`session_hash`) REFERENCES `sessions`(`token_hash`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `favorites_expiry` ON `favorite_previews` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`rating` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rating_range" CHECK("reviews"."rating" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_media` ON `reviews` (`user_id`,`media_id`);--> statement-breakpoint
CREATE INDEX `reviews_media_updated` ON `reviews` (`media_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`media_id` text NOT NULL,
	`type` text NOT NULL,
	`visibility` text NOT NULL,
	`invite_hash` text,
	`capacity` integer NOT NULL,
	`unit` integer DEFAULT 1 NOT NULL,
	`paused` integer DEFAULT 1 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`source_kind` text DEFAULT 'external' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`state_updated_at` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "room_type" CHECK("rooms"."type" IN ('watch','read')),
	CONSTRAINT "room_visibility" CHECK("rooms"."visibility" IN ('public','private'))
);
--> statement-breakpoint
CREATE INDEX `rooms_host_open` ON `rooms` (`host_id`,`closed_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_expiry` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`password_hash` text,
	`discord_id` text,
	`avatar` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);--> statement-breakpoint
CREATE TABLE `comment_votes` (
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`comment_id`, `user_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "vote_range" CHECK("comment_votes"."value" IN (-1,1))
);
