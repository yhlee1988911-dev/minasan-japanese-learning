-- Rename the default visible vocabulary category to the current product wording.
UPDATE courses
SET title = 'N5-N4 词汇',
    description = '系统默认 N5-N4 基础词汇，后续可按 N3、N2、N1 继续扩展。',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'system-beginner-50';

UPDATE lessons
SET title = 'N5-N4 词汇',
    description = '本类别收录 2481 个基础词汇。',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'system-n5-n4-vocabulary';
