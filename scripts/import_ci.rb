require 'fileutils'
require 'json'
require 'open3'
require 'rexml/document'
require 'rexml/xpath'
require 'time'

ROOT = File.expand_path('..', __dir__)
SOURCE_FILE = File.expand_path(ARGV.first || File.join('data', 'newci.xlsx'), ROOT)
SOURCE_LABEL = SOURCE_FILE.start_with?("#{ROOT}/") ? SOURCE_FILE.delete_prefix("#{ROOT}/") : File.basename(SOURCE_FILE)
OUTPUT_DIR = File.join(ROOT, 'src', 'data', 'generated')

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

def parse_accents(display, numeric)
  circled = {
    '⓪' => 0, '①' => 1, '②' => 2, '③' => 3, '④' => 4,
    '⑤' => 5, '⑥' => 6, '⑦' => 7, '⑧' => 8, '⑨' => 9,
    '⑩' => 10, '⑪' => 11, '⑫' => 12, '⑬' => 13, '⑭' => 14,
    '⑮' => 15, '⑯' => 16, '⑰' => 17, '⑱' => 18, '⑲' => 19, '⑳' => 20
  }
  values = display.to_s.scan(/[⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/).map { |item| circled[item] }
  return values.uniq unless values.empty?

  numeric.to_s.scan(/\d/).map(&:to_i).uniq
end

raise "找不到源文件：#{SOURCE_FILE}" unless File.exist?(SOURCE_FILE)

shared_document = REXML::Document.new(read_archive('xl/sharedStrings.xml'))
shared_strings = []
REXML::XPath.each(shared_document, '//*[local-name()="si"]') do |node|
  shared_strings << REXML::XPath.match(node, './/*[local-name()="t"]').map { |item| item.text.to_s }.join
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

report = {
  source: SOURCE_LABEL,
  importedAt: Time.now.utc.iso8601,
  sourceRows: rows.length - 1,
  importedVocabulary: 0,
  skippedRows: [],
  inheritedLessons: [],
  missingReadings: [],
  missingMeanings: [],
  duplicateTermReadingGroups: 0,
  lessonCounts: {}
}

vocabulary = []
lesson_words = Hash.new { |hash, key| hash[key] = [] }
previous_lesson = nil

rows.drop(1).each do |row_number, row|
  term = row['B'].to_s.strip
  if term.empty?
    report[:skippedRows] << { row: row_number, reason: '日文词为空' }
    next
  end

  lesson_label = row['I'].to_s.strip
  if lesson_label.empty? && previous_lesson
    lesson_label = previous_lesson
    report[:inheritedLessons] << { row: row_number, term: term, lesson: lesson_label }
  end
  lesson_number = lesson_label[/\d+/].to_i
  unless (1..50).cover?(lesson_number)
    report[:skippedRows] << { row: row_number, term: term, reason: "无效课时 #{lesson_label.inspect}" }
    next
  end
  previous_lesson = lesson_label

  reading = row['C'].to_s.strip
  if reading.empty?
    reading = term
    report[:missingReadings] << { row: row_number, term: term }
  end

  meaning = row['H'].to_s.strip
  if meaning.empty?
    meaning = '释义待补充'
    report[:missingMeanings] << { row: row_number, term: term }
  end

  id = format('v-%04d', row['A'].to_i.nonzero? || vocabulary.length + 1)
  lesson_id = format('lesson-%02d', lesson_number)
  accent_display = row['E'].to_s.empty? ? row['D'].to_s : row['E'].to_s

  item = {
    id: id,
    term: term,
    reading: reading,
    accents: parse_accents(row['E'], row['D']),
    accentDisplay: accent_display,
    partOfSpeech: row['G'].to_s.empty? ? '未分类' : row['G'],
    partOfSpeechCode: row['F'].to_s,
    meanings: [meaning],
    sourceLesson: lesson_number.to_s,
    sourceLessonLabel: lesson_label,
    sourceSequence: row['A'].to_i,
    sourceRow: row_number
  }
  dictionary_form = row['J'].to_s.strip
  item[:dictionaryForm] = dictionary_form unless dictionary_form.empty?

  vocabulary << item
  lesson_words[lesson_id] << id
end

lesson_titles = {
  1 => '自我介绍与职业',
  2 => '身边物品与指示',
  3 => '场所、楼层与方位',
  4 => '时间与日常作息',
  5 => '日期、交通与出行',
  6 => '饮食、购物与日常动作',
  7 => '给予、收受与拜访',
  8 => '形容词与事物描述',
  9 => '喜好、能力与原因',
  10 => '存在、位置与周边设施',
  11 => '数量、人数与时间',
  12 => '季节、比较与感想',
  13 => '愿望、目的与点餐',
  14 => '请求、指示与进行动作',
  15 => '许可、禁止与生活状态',
  16 => '动作顺序、交通与人物描述',
  17 => '健康、义务与禁止',
  18 => '能力、兴趣与事前准备',
  19 => '经历、变化与生活习惯',
  20 => '简体会话与朋友交流',
  21 => '想法、意见与转述',
  22 => '人物修饰、服装与住房',
  23 => '时间条件、道路与机器操作',
  24 => '互助、带领与介绍',
  25 => '条件、转勤与告别',
  26 => '原因说明、规则与生活问题',
  27 => '能力、可见可闻与可能',
  28 => '同时动作、习惯与理由',
  29 => '物品状态、故障与遗失',
  30 => '准备、布置与保持状态',
  31 => '计划、打算与未来安排',
  32 => '建议、推测与健康判断',
  33 => '命令、禁止与标志规则',
  34 => '按照说明、完成后的动作',
  35 => '条件表达、变化与旅行建议',
  36 => '目标、习惯与能力提升',
  37 => '被动表达、发现与生产',
  38 => '动作名词化、原因与评价',
  39 => '原因、事故与情绪反应',
  40 => '疑问内容、测量与尝试',
  41 => '敬意表达与给予收受',
  42 => '目的、用途与费用',
  43 => '状态变化、趋势与样态',
  44 => '过度、难易与外观调整',
  45 => '意外情况、规则与结果',
  46 => '动作阶段、刚刚与即将',
  47 => '传闻、推测与感官判断',
  48 => '使役、许可与委托',
  49 => '尊敬表达与正式交流',
  50 => '谦逊表达与致谢'
}

lessons = (1..50).map do |number|
  lesson_id = format('lesson-%02d', number)
  count = lesson_words[lesson_id].length
  report[:lessonCounts][number.to_s] = count
  {
    id: lesson_id,
    order: number,
    title: lesson_titles[number] || "第 #{number} 课",
    description: "本课包含 #{count} 个词汇。",
    vocabularyIds: lesson_words[lesson_id],
    sentenceIds: []
  }
end

duplicates = vocabulary.group_by { |item| [item[:term], item[:reading]] }.count { |_key, items| items.length > 1 }
report[:importedVocabulary] = vocabulary.length
report[:duplicateTermReadingGroups] = duplicates

FileUtils.mkdir_p(OUTPUT_DIR)
File.write(File.join(OUTPUT_DIR, 'vocabulary.json'), JSON.pretty_generate(vocabulary))
File.write(File.join(OUTPUT_DIR, 'lessons.json'), JSON.pretty_generate(lessons))
File.write(File.join(OUTPUT_DIR, 'import-report.json'), JSON.pretty_generate(report))

puts "已导入 #{vocabulary.length} 条词汇，生成 #{lessons.length} 课"
puts "质量报告：#{File.join(OUTPUT_DIR, 'import-report.json')}"
