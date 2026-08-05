ALTER TABLE `sync_state` ADD `latest_version_code` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `latest_version_name` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `min_version_code` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `install_url` text;