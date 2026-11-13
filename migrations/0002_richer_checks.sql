CREATE TABLE `check_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`check_result_id` text,
	`key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `check`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `check_photo_check_idx` ON `check_photo` (`check_id`);--> statement-breakpoint
ALTER TABLE `check_result` ADD `section` text DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE `check_result` ADD `status` text DEFAULT 'pass' NOT NULL;--> statement-breakpoint
ALTER TABLE `check_result` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `check_result` ADD `severity` text;--> statement-breakpoint
ALTER TABLE `checklist_item` ADD `section` text DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE `defect` ADD `check_result_id` text;--> statement-breakpoint
-- Results saved before answers existed: an unticked item was a failed item.
UPDATE `check_result` SET `status` = 'fail' WHERE `ok` = 0;
