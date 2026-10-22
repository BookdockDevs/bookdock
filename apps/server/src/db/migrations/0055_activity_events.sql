CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`event_type` text NOT NULL,
	`audience` text NOT NULL,
	`library_id` text NOT NULL,
	`actor_user_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`work_id` text,
	`version_id` text,
	`operation_id` text,
	`occurred_at` integer NOT NULL,
	`snapshot_work_title` text,
	`snapshot_object_label` text,
	`snapshot_author_id` text,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_idempotency_unique` ON `activity_events` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `activity_events_library_page_idx` ON `activity_events` (`library_id`,`audience`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `activity_events_actor_page_idx` ON `activity_events` (`actor_user_id`,`event_type`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE INDEX `activity_events_operation_idx` ON `activity_events` (`library_id`,`actor_user_id`,`operation_id`,`event_type`,`audience`);
--> statement-breakpoint
INSERT OR IGNORE INTO `activity_events` (`id`,`idempotency_key`,`event_type`,`audience`,`library_id`,`actor_user_id`,`target_kind`,`target_id`,`work_id`,`version_id`,`occurred_at`)
SELECT 'history-idea-' || i.id, 'idea.published:' || i.id, 'idea.published', 'library', i.shared_library_id, i.user_id, 'idea', i.id, lbv.library_book_id, i.book_version_id, i.created_at
FROM ideas i
JOIN libraries l ON l.id = i.shared_library_id AND l.type = 'shared'
LEFT JOIN library_book_versions lbv ON lbv.id = i.source_library_book_version_id AND lbv.library_id = i.shared_library_id
WHERE i.visibility = 'shared' AND i.deleted_at IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `activity_events` (`id`,`idempotency_key`,`event_type`,`audience`,`library_id`,`actor_user_id`,`target_kind`,`target_id`,`work_id`,`version_id`,`occurred_at`)
SELECT 'history-review-' || r.id, 'review.published:' || r.id, 'review.published', 'library', r.source_library_id, r.user_id, 'review', r.id, r.source_library_book_id, r.read_book_version_id, r.created_at
FROM book_reviews r
JOIN libraries l ON l.id = r.source_library_id AND l.type = 'shared'
WHERE r.visibility = 'shared' AND r.source_library_id IS NOT NULL AND r.source_library_book_id IS NOT NULL;
