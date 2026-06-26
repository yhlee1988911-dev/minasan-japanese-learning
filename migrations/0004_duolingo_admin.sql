ALTER TABLE vocabulary ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vocabulary ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_vocabulary_duolingo_lookup ON vocabulary(course_id, term, reading);
CREATE INDEX IF NOT EXISTS idx_vocabulary_active_lesson ON vocabulary(course_id, is_active, lesson_id);
