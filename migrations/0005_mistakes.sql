CREATE TABLE IF NOT EXISTS mistake_progress (
  user_id TEXT NOT NULL,
  mistake_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL DEFAULT 'duolingo',
  prompt TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  speech TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '[]',
  wrong_count INTEGER NOT NULL DEFAULT 1,
  last_wrong_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, mistake_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mistake_progress_user_lesson ON mistake_progress(user_id, lesson_id);
