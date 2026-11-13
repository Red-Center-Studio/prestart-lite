CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_name` text DEFAULT 'My Fleet' NOT NULL,
	`support_email` text DEFAULT '' NOT NULL,
	`setup_help_url` text DEFAULT 'https://redcenterstudio.com/' NOT NULL,
	`show_setup_offer` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "app_settings_single_row" CHECK("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `check` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`vehicle_name` text NOT NULL,
	`driver_id` text NOT NULL,
	`driver_name` text NOT NULL,
	`odometer_km` integer NOT NULL,
	`odometer_went_back` integer DEFAULT false NOT NULL,
	`passed` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`photo_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `check_vehicle_created_idx` ON `check` (`vehicle_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `check_driver_created_idx` ON `check` (`driver_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `check_result` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`checklist_item_id` text NOT NULL,
	`label` text NOT NULL,
	`ok` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `check`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `check_result_check_idx` ON `check_result` (`check_id`);--> statement-breakpoint
CREATE TABLE `checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `defect` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`vehicle_name` text NOT NULL,
	`check_id` text,
	`description` text NOT NULL,
	`severity` text DEFAULT 'minor' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_by_id` text NOT NULL,
	`reported_by_name` text NOT NULL,
	`photo_key` text,
	`workshop_notes` text DEFAULT '' NOT NULL,
	`fixed_at` text,
	`fixed_by_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "defect_severity_check" CHECK("defect"."severity" IN ('minor', 'major', 'critical')),
	CONSTRAINT "defect_status_check" CHECK("defect"."status" IN ('open', 'in_progress', 'fixed'))
);
--> statement-breakpoint
CREATE INDEX `defect_status_severity_idx` ON `defect` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `defect_vehicle_status_idx` ON `defect` (`vehicle_id`,`status`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "user_role_check" CHECK("user"."role" IS NULL OR "user"."role" IN ('admin', 'workshop', 'driver'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `vehicle` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rego` text DEFAULT '' NOT NULL,
	`vehicle_type` text DEFAULT '' NOT NULL,
	`odometer_km` integer DEFAULT 0 NOT NULL,
	`rego_due` text,
	`service_due` text,
	`status` text DEFAULT 'in_service' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "vehicle_status_check" CHECK("vehicle"."status" IN ('in_service', 'off_road')),
	CONSTRAINT "vehicle_odometer_check" CHECK("vehicle"."odometer_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);