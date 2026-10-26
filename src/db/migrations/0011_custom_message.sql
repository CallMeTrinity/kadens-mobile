CREATE TABLE `custom_message` (
	`id` integer PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`media_url` text,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`seen_at` text
);
