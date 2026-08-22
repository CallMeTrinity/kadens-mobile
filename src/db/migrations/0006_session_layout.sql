CREATE TABLE `session_layout` (
	`scheduled_uuid` text NOT NULL,
	`exercise_key` text NOT NULL,
	`position` integer NOT NULL,
	`chain` integer,
	PRIMARY KEY(`scheduled_uuid`, `exercise_key`),
	FOREIGN KEY (`scheduled_uuid`) REFERENCES `scheduled_workout`(`uuid`) ON UPDATE no action ON DELETE cascade
);
