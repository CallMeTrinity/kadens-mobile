CREATE TABLE `exercise_setup` (
	`exercise_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
