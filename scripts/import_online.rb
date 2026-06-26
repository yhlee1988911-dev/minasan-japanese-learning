require 'fileutils'
require 'json'
require 'open3'
require 'rexml/document'
require 'rexml/xpath'
require 'time'

ROOT = File.expand_path('..', __dir__)
SOURCE_FILE = File.expand_path(ARGV.first || File.join('data', 'online.xlsx'), ROOT)
OUTPUT_DIR = File.join(ROOT, 'src', 'data', 'generated')
MIGRATIONS_DIR = File.join(ROOT, 'migrations')
COURSE_ID = 'duolingo'
COURSE_TITLE = 'duolingo'
WORDS_PER_LESSON = 25

def read_archive(path)
  content, status = Open3.capture2('unzip', '-p', SOURCE_FILE, path)
  raise "无法读取 #{path}" unless status.success?
  content
end

def attribute(node, name)
  node.attributes.get_attribute(name)&.value
end

def cell_value(cell, shared_strings)
  type = attribute(cell, 't')
  if type == 'inlineStr'
    return REXML::XPath.match(cell, './/*[local-name()="t"]').map { |item| item.text.to_s }.join
  end

  value = REXML::XPath.first(cell, './*[local-name()="v"]')&.text.to_s
  type == 's' ? shared_strings[value.to_i].to_s : value
end

def sql(value)
  return 'NULL' if value.nil? || value.to_s.empty?
  "'#{value.to_s.gsub("'", "''")}'"
end

raise "找不到源文件：#{SOURCE_FILE}" unless File.exist?(SOURCE_FILE)

shared_strings = []
begin
  shared_document = REXML::Document.new(read_archive('xl/sharedStrings.xml'))
  REXML::XPath.each(shared_document, '//*[local-name()="si"]') do |node|
    shared_strings << REXML::XPath.match(node, './/*[local-name()="t"]').map { |item| item.text.to_s }.join
  end
rescue StandardError
  shared_strings = []
end

sheet = REXML::Document.new(read_archive('xl/worksheets/sheet1.xml'))
rows = []
REXML::XPath.each(sheet, '//*[local-name()="sheetData"]/*[local-name()="row"]') do |row|
  values = {}
  REXML::XPath.each(row, './*[local-name()="c"]') do |cell|
    column = attribute(cell, 'r').to_s[/[A-Z]+/]
    values[column] = cell_value(cell, shared_strings).strip
  end
  rows << [attribute(row, 'r').to_i, values]
end

vocabulary = []
lesson_words = Hash.new { |hash, key| hash[key] = [] }

rows.drop(1).each do |row_number, row|
  sequence = row['A'].to_i
  term = row['B'].to_s.strip
  reading = row['C'].to_s.strip
  romaji = row['D'].to_s.strip
  meaning = row['E'].to_s.strip
  next if term.empty?

  sequence = vocabulary.length + 1 if sequence <= 0
  lesson_number = ((sequence - 1) / WORDS_PER_LESSON) + 1
  lesson_id = format('duolingo-lesson-%02d', lesson_number)
  id = format('duo-v-%04d', sequence)
  item = {
    id: id,
    courseId: COURSE_ID,
    term: term,
    reading: reading.empty? ? term : reading,
    accents: [],
    accentDisplay: '',
    partOfSpeech: '未分类',
    partOfSpeechCode: '',
    meanings: [meaning.empty? ? '释义待补充' : meaning],
    sourceLesson: lesson_id,
    sourceLessonLabel: "#{COURSE_TITLE} #{lesson_number}",
    sourceSequence: sequence,
    sourceRow: row_number,
    romaji: romaji
  }
  vocabulary << item
  lesson_words[lesson_id] << id
end

lessons = lesson_words.keys.sort.map.with_index(1) do |lesson_id, index|
  count = lesson_words[lesson_id].length
  {
    id: lesson_id,
    courseId: COURSE_ID,
    order: index,
    title: "duolingo #{index}",
    description: "本课包含 #{count} 个 duolingo 词汇。",
    vocabularyIds: lesson_words[lesson_id],
    sentenceIds: []
  }
end

payload = {
  course: {
    id: COURSE_ID,
    title: COURSE_TITLE,
    description: '来自 online.xlsx 的 duolingo 词汇课程。',
    lessonIds: lessons.map { |lesson| lesson[:id] }
  },
  lessons: lessons,
  vocabulary: vocabulary,
  sentences: []
}

FileUtils.mkdir_p(OUTPUT_DIR)
FileUtils.mkdir_p(MIGRATIONS_DIR)
File.write(File.join(OUTPUT_DIR, 'duolingo-fallback.json'), JSON.pretty_generate(payload))

seed_lines = []
seed_lines << "-- Generated from data/online.xlsx at #{Time.now.utc.iso8601}"
seed_lines << "DELETE FROM vocabulary WHERE course_id = 'duolingo';"
seed_lines << "DELETE FROM lessons WHERE course_id = 'duolingo';"
seed_lines << "DELETE FROM courses WHERE id = 'duolingo';"
seed_lines << "INSERT INTO courses (id, title, description, source, updated_at) VALUES (#{sql(COURSE_ID)}, #{sql(COURSE_TITLE)}, #{sql(payload[:course][:description])}, 'online.xlsx', CURRENT_TIMESTAMP);"
lessons.each do |lesson|
  seed_lines << "INSERT INTO lessons (id, course_id, title, order_index, description) VALUES (#{sql(lesson[:id])}, #{sql(COURSE_ID)}, #{sql(lesson[:title])}, #{lesson[:order]}, #{sql(lesson[:description])});"
end
vocabulary.each do |word|
  seed_lines << "INSERT INTO vocabulary (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at) VALUES (#{sql(word[:id])}, #{sql(COURSE_ID)}, #{sql(word[:sourceLesson])}, #{sql(word[:term])}, #{sql(word[:reading])}, #{sql(word[:meanings].first)}, #{sql(word[:romaji])}, #{sql(word[:partOfSpeech])}, '[]', #{word[:sourceRow]}, CURRENT_TIMESTAMP);"
end
File.write(File.join(MIGRATIONS_DIR, '0002_seed_duolingo.sql'), seed_lines.join("\n") + "\n")

report = {
  source: 'data/online.xlsx',
  importedAt: Time.now.utc.iso8601,
  importedVocabulary: vocabulary.length,
  lessons: lessons.length,
  wordsPerLesson: WORDS_PER_LESSON
}
File.write(File.join(OUTPUT_DIR, 'duolingo-import-report.json'), JSON.pretty_generate(report))

puts "已生成 duolingo 课程：#{vocabulary.length} 词，#{lessons.length} 课"
puts "fallback：#{File.join(OUTPUT_DIR, 'duolingo-fallback.json')}"
puts "D1 seed：#{File.join(MIGRATIONS_DIR, '0002_seed_duolingo.sql')}"
