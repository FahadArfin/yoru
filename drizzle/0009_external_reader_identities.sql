CREATE TABLE `external_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`upstream_key` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `external_media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_editions_canonical` ON `external_editions` (`media_id`,`upstream_key`);--> statement-breakpoint
CREATE TABLE `external_media` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`upstream_key` text NOT NULL,
	`language` text NOT NULL,
	`classification` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `reader_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_media_canonical` ON `external_media` (`source_id`,`upstream_key`,`language`);--> statement-breakpoint
CREATE TABLE `reader_equivalences` (
	`left_id` text NOT NULL,
	`right_id` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`left_id`, `right_id`),
	CONSTRAINT "reader_equivalence_order" CHECK("reader_equivalences"."left_id"<"reader_equivalences"."right_id")
);
--> statement-breakpoint
CREATE TABLE `reader_local_bindings` (
	`reference_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`media_id` text,
	`edition_id` text,
	`kind` text NOT NULL,
	`bridge_instance` text NOT NULL,
	`local_id` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `reader_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `external_media`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `external_editions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reader_binding_owner" CHECK(("reader_local_bindings"."kind"='media' AND "reader_local_bindings"."media_id" IS NOT NULL AND "reader_local_bindings"."media_id"="reader_local_bindings"."reference_id" AND "reader_local_bindings"."edition_id" IS NULL) OR ("reader_local_bindings"."kind"='edition' AND "reader_local_bindings"."edition_id" IS NOT NULL AND "reader_local_bindings"."edition_id"="reader_local_bindings"."reference_id" AND "reader_local_bindings"."media_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reader_bindings_local` ON `reader_local_bindings` (`bridge_instance`,`kind`,`local_id`);--> statement-breakpoint
CREATE TABLE `reader_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`integration` text NOT NULL,
	`upstream_source_id` text,
	`provider_key` text NOT NULL,
	`language` text NOT NULL,
	`classification` text NOT NULL,
	`capabilities` text NOT NULL,
	`bridge_instance` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reader_sources_upstream` ON `reader_sources` (`integration`,`upstream_source_id`);
