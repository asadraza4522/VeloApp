PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_state` (
	`table_name` text PRIMARY KEY NOT NULL,
	`cursor_updated_at` text DEFAULT '' NOT NULL,
	`cursor_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sync_state`("table_name", "cursor_updated_at", "cursor_id") SELECT "table_name", "cursor_updated_at", "cursor_id" FROM `sync_state`;--> statement-breakpoint
DROP TABLE `sync_state`;--> statement-breakpoint
ALTER TABLE `__new_sync_state` RENAME TO `sync_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `downloads` ADD `device_id` text;