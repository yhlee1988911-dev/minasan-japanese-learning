import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const vocabulary = readJson('src/data/generated/vocabulary.json');
const generatedSentences = readJson('src/data/generated/sentences-11-50.json');

const sql = (value) => {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const numberOrNull = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : 'NULL';

const systemCourseId = 'system-beginner-50';
const systemLessonId = 'system-n5-n4-vocabulary';
const lines = [
  '-- Baiduminasan catalog split: SQL-backed system course and user-owned custom courses.',
  '-- Generated from src/data/generated/*.json by scripts/generate_baiduminasan_catalog_seed.mjs.',
  '',
  "ALTER TABLE courses ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'system';",
  'ALTER TABLE courses ADD COLUMN owner_user_id TEXT;',
  "ALTER TABLE courses ADD COLUMN source_type TEXT NOT NULL DEFAULT 'system_seed';",
  'ALTER TABLE courses ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;',
  'ALTER TABLE courses ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;',
  'ALTER TABLE courses ADD COLUMN created_at TEXT;',
  '',
  'ALTER TABLE lessons ADD COLUMN owner_user_id TEXT;',
  'ALTER TABLE lessons ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;',
  'ALTER TABLE lessons ADD COLUMN created_at TEXT;',
  'ALTER TABLE lessons ADD COLUMN updated_at TEXT;',
  '',
  "ALTER TABLE vocabulary ADD COLUMN accent_display TEXT NOT NULL DEFAULT '';",
  "ALTER TABLE vocabulary ADD COLUMN part_of_speech_code TEXT NOT NULL DEFAULT '';",
  'ALTER TABLE vocabulary ADD COLUMN owner_user_id TEXT;',
  'ALTER TABLE vocabulary ADD COLUMN created_at TEXT;',
  '',
  'ALTER TABLE sentences ADD COLUMN owner_user_id TEXT;',
  'ALTER TABLE sentences ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;',
  'ALTER TABLE sentences ADD COLUMN created_at TEXT;',
  "ALTER TABLE sentences ADD COLUMN cloze_text TEXT NOT NULL DEFAULT '';",
  '',
  "DELETE FROM mistake_progress WHERE course_id = 'duolingo';",
  "DELETE FROM lesson_progress WHERE course_id = 'duolingo';",
  "DELETE FROM vocabulary_progress WHERE course_id = 'duolingo';",
  "DELETE FROM sentence_progress WHERE course_id = 'duolingo';",
  "DELETE FROM sentences WHERE course_id = 'duolingo';",
  "DELETE FROM vocabulary WHERE course_id = 'duolingo';",
  "DELETE FROM lessons WHERE course_id = 'duolingo';",
  "DELETE FROM courses WHERE id = 'duolingo';",
  '',
  `DELETE FROM sentences WHERE course_id = ${sql(systemCourseId)};`,
  `DELETE FROM vocabulary WHERE course_id = ${sql(systemCourseId)};`,
  `DELETE FROM lessons WHERE course_id = ${sql(systemCourseId)};`,
  `DELETE FROM courses WHERE id = ${sql(systemCourseId)};`,
  '',
  `INSERT INTO courses (id, title, description, source, updated_at, owner_type, owner_user_id, source_type, sort_order, is_active, created_at) VALUES (${sql(systemCourseId)}, ${sql('N4-N5 词汇')}, ${sql('系统默认 N4-N5 基础词汇，后续可按 N3、N2、N1 继续扩展。')}, ${sql('generated-json')}, CURRENT_TIMESTAMP, ${sql('system')}, NULL, ${sql('system_seed')}, 1, 1, CURRENT_TIMESTAMP);`,
  `INSERT INTO lessons (id, course_id, title, order_index, description, owner_user_id, is_active, created_at, updated_at) VALUES (${sql(systemLessonId)}, ${sql(systemCourseId)}, ${sql('N4-N5 词汇')}, 1, ${sql(`本类别收录 ${vocabulary.length} 个基础词汇。`)}, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
  ''
];

for (const word of vocabulary) {
  const meaning = Array.isArray(word.meanings) ? word.meanings.join('；') : '';
  const tags = JSON.stringify({
    accents: Array.isArray(word.accents) ? word.accents : [],
    sourceLessonLabel: word.sourceLessonLabel || '',
    sourceSequence: word.sourceSequence || null
  });
  lines.push(
    `INSERT INTO vocabulary (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at, is_active, deleted_at, accent_display, part_of_speech_code, owner_user_id, created_at) VALUES (${sql(`system-${word.id}`)}, ${sql(systemCourseId)}, ${sql(systemLessonId)}, ${sql(word.term)}, ${sql(word.reading)}, ${sql(meaning)}, ${sql(word.romaji || '')}, ${sql(word.partOfSpeech || '')}, ${sql(tags)}, ${numberOrNull(word.sourceRow)}, CURRENT_TIMESTAMP, 1, NULL, ${sql(word.accentDisplay || '')}, ${sql(word.partOfSpeechCode || '')}, NULL, CURRENT_TIMESTAMP);`
  );
}

lines.push('');

for (const sentence of generatedSentences) {
  const answers = Array.isArray(sentence.answers) ? sentence.answers : [];
  lines.push(
    `INSERT INTO sentences (id, course_id, lesson_id, text, reading, meaning, answers, updated_at, owner_user_id, is_active, created_at, cloze_text) VALUES (${sql(`system-${sentence.id}`)}, ${sql(systemCourseId)}, ${sql(systemLessonId)}, ${sql(sentence.text)}, ${sql(sentence.reading)}, ${sql(sentence.meaning)}, ${sql(JSON.stringify(answers))}, CURRENT_TIMESTAMP, NULL, 1, CURRENT_TIMESTAMP, ${sql(sentence.clozeText || '')});`
  );
}

lines.push(
  '',
  'CREATE INDEX IF NOT EXISTS idx_courses_owner_active ON courses(owner_type, owner_user_id, is_active, sort_order);',
  'CREATE INDEX IF NOT EXISTS idx_lessons_course_active_order ON lessons(course_id, is_active, order_index);',
  'CREATE INDEX IF NOT EXISTS idx_vocabulary_course_active_lesson ON vocabulary(course_id, is_active, lesson_id, source_row);',
  'CREATE INDEX IF NOT EXISTS idx_sentences_course_active_lesson ON sentences(course_id, is_active, lesson_id);',
  ''
);

fs.writeFileSync(path.join(root, 'migrations/0006_baiduminasan_catalog.sql'), `${lines.join('\n')}\n`);
console.log(`generated migrations/0006_baiduminasan_catalog.sql with 1 lesson, ${vocabulary.length} words, ${generatedSentences.length} sentences`);
