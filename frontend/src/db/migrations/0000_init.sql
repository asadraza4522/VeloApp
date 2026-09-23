CREATE TABLE `download_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`download_id` text NOT NULL,
	`resolver_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`failure_code` text,
	`detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL,
	`server_rev` integer,
	FOREIGN KEY (`download_id`) REFERENCES `downloads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `download_attempts_download_idx` ON `download_attempts` (`download_id`);--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`variant_json` text,
	`container` text,
	`resolution` text,
	`filename` text,
	`local_uri` text,
	`filesize` integer,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`failure_code` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`progress_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`resolver_id` text,
	`completed_at` integer,
	`file_deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL,
	`server_rev` integer,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `downloads_source_idx` ON `downloads` (`source_id`);--> statement-breakpoint
CREATE INDEX `downloads_status_idx` ON `downloads` (`deleted_at`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `kv_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`original_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`platform` text DEFAULT 'Other' NOT NULL,
	`platform_media_id` text,
	`creator_id` text,
	`creator_name` text,
	`title` text,
	`description` text,
	`thumbnail_url` text,
	`media_type` text DEFAULT 'unknown' NOT NULL,
	`duration_ms` integer,
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_checked_at` integer,
	`status` text DEFAULT 'saved' NOT NULL,
	`failure_code` text,
	`favorite` integer DEFAULT false NOT NULL,
	`resolve_state` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL,
	`server_rev` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_canonical_uq` ON `media_sources` (`canonical_url`) WHERE "media_sources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `media_sources_updated_idx` ON `media_sources` (`deleted_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `media_sources_platform_idx` ON `media_sources` (`platform`,`media_type`);--> statement-breakpoint
CREATE INDEX `media_sources_media_id_idx` ON `media_sources` (`platform`,`platform_media_id`);--> statement-breakpoint
CREATE TABLE `organization_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`filename_template` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL,
	`server_rev` integer
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`dirty` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_urls` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`dirty` integer DEFAULT true NOT NULL,
	`server_rev` integer,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_urls_source_idx` ON `source_urls` (`source_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`table_name` text PRIMARY KEY NOT NULL,
	`cursor_updated_at` integer DEFAULT 0 NOT NULL,
	`cursor_id` text DEFAULT '' NOT NULL
);
