CREATE TABLE `preference` (
	`id` integer PRIMARY KEY NOT NULL,
	`rest_seconds` integer DEFAULT 90 NOT NULL,
	`vibrate` integer DEFAULT true NOT NULL,
	CONSTRAINT "preference_singleton" CHECK("preference"."id" = 1)
);
