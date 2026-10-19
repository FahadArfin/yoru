CREATE TABLE `reading_account_snapshots` (
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`record_kind` text NOT NULL,
	`destination` text NOT NULL,
	`metadata` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `media_id`, `record_kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reading_account_kind" CHECK("reading_account_snapshots"."record_kind" IN ('library','resume')),
	CONSTRAINT "reading_account_destination" CHECK("reading_account_snapshots"."destination" IN ('yoru','ara-ara'))
);
