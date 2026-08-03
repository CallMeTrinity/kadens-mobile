CREATE TABLE `exercise` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`activity` text NOT NULL,
	`target_areas` text DEFAULT '[]' NOT NULL,
	`media_url` text,
	`is_global` integer DEFAULT false NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `exercise_history` (
	`exercise_id` integer PRIMARY KEY NOT NULL,
	`last` text,
	`best` text,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `logged_exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduled_uuid` text NOT NULL,
	`exercise_id` integer,
	`exercise_name` text NOT NULL,
	`source_prescribed_id` integer,
	`position` integer NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`scheduled_uuid`) REFERENCES `scheduled_workout`(`uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_logged_exercise_scheduled` ON `logged_exercise` (`scheduled_uuid`,`position`);--> statement-breakpoint
CREATE TABLE `logged_set` (
	`uuid` text PRIMARY KEY NOT NULL,
	`logged_exercise_id` integer NOT NULL,
	`position` integer NOT NULL,
	`type` text DEFAULT 'normal' NOT NULL,
	`reps` integer,
	`weight_kg` real,
	`duration_seconds` integer,
	`rpe` integer,
	`completed_at` text,
	FOREIGN KEY (`logged_exercise_id`) REFERENCES `logged_exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_logged_set_exercise` ON `logged_set` (`logged_exercise_id`,`position`);--> statement-breakpoint
CREATE TABLE `mutation_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prescribed_snapshot` (
	`scheduled_uuid` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	FOREIGN KEY (`scheduled_uuid`) REFERENCES `scheduled_workout`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scheduled_workout` (
	`uuid` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`title` text,
	`freeform` integer DEFAULT false NOT NULL,
	`started_at` text,
	`ended_at` text,
	`completion_notes` text,
	`plan` text
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_workout_date` ON `scheduled_workout` (`date`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`api_url` text,
	`server_time` text,
	`window_from` text,
	`window_to` text,
	`last_pulled_at` text,
	`last_pushed_at` text,
	CONSTRAINT "sync_state_singleton" CHECK("sync_state"."id" = 1)
);
