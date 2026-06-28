-- Merge the visible system course from the old lesson structure into one N5-N4 vocabulary category.
UPDATE courses
SET title = 'N5-N4 词汇',
    description = '系统默认 N5-N4 基础词汇，后续可按 N3、N2、N1 继续扩展。',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'system-beginner-50';

INSERT INTO lessons (
  id,
  course_id,
  title,
  order_index,
  description,
  owner_user_id,
  is_active,
  created_at,
  updated_at
)
VALUES (
  'system-n5-n4-vocabulary',
  'system-beginner-50',
  'N5-N4 词汇',
  1,
  '本类别收录 2481 个基础词汇。',
  NULL,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  order_index = excluded.order_index,
  description = excluded.description,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;

UPDATE vocabulary
SET lesson_id = 'system-n5-n4-vocabulary',
    updated_at = CURRENT_TIMESTAMP
WHERE course_id = 'system-beginner-50';

UPDATE sentences
SET lesson_id = 'system-n5-n4-vocabulary',
    updated_at = CURRENT_TIMESTAMP
WHERE course_id = 'system-beginner-50';

UPDATE vocabulary_progress
SET lesson_id = 'system-n5-n4-vocabulary'
WHERE course_id = 'system-beginner-50';

UPDATE sentence_progress
SET lesson_id = 'system-n5-n4-vocabulary'
WHERE course_id = 'system-beginner-50';

UPDATE lesson_progress
SET lesson_id = 'system-n5-n4-vocabulary'
WHERE course_id = 'system-beginner-50';

UPDATE mistake_progress
SET lesson_id = 'system-n5-n4-vocabulary'
WHERE course_id = 'system-beginner-50';

DELETE FROM lessons
WHERE course_id = 'system-beginner-50'
  AND id <> 'system-n5-n4-vocabulary';
