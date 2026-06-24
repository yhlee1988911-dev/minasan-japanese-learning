require 'json'

ROOT = File.expand_path('..', __dir__)
VOCABULARY_FILE = File.join(ROOT, 'src', 'data', 'generated', 'vocabulary.json')
OUTPUT_FILE = File.join(ROOT, 'src', 'data', 'generated', 'sentences-11-50.json')
REPORT_FILE = File.join(ROOT, 'src', 'data', 'generated', 'sentence-report-11-50.json')

def punctuation(text)
  text.match?(/[。！？!?]$/) ? text : "#{text}。"
end

def usable?(item)
  term = item['term'].to_s.strip
  reading = item['reading'].to_s.strip
  meaning = item.fetch('meanings', []).first.to_s.strip
  return false if term.empty? || reading.empty? || meaning.empty? || meaning == '释义待补充'
  return false if term.length > 32 || term.match?(/[〜~\[\]［］＿\/]/) || term.match?(/^[-ー]/)
  return false if term.match?(/^[0-9０-９]+$/) || term.include?('　')
  return false if term == '思い出しまう'
  true
end

def complete_expression?(term)
  term.match?(/[。！？!?]$/) ||
    term.match?(/(ます|ました|ません|です|でした|ください|ましょう|あります|います|なります|できます|いい|悪い|多い|少ない|高い|低い|か|ね|よ|ないと…|お元気で)$/)
end

def priority(item)
  part = item['partOfSpeech'].to_s
  term = item['term'].to_s
  return 0 if part == '未分类' && term.length >= 4 && complete_expression?(term)
  return 1 if part.start_with?('动')
  return 2 if ['い形', 'な形'].include?(part)
  return 3 if part == '名词'
  4
end

def build_sentence(item, lesson, sequence)
  term = item['term'].strip
  reading = item['reading'].strip
  meaning = item['meanings'].first.strip
  part = item['partOfSpeech'].to_s

  if (part == '未分类' && complete_expression?(term)) || part.start_with?('动')
    text = punctuation(term)
    sentence_reading = punctuation(reading)
    cloze = '＿＿。'
  elsif ['い形', 'な形'].include?(part)
    text = punctuation("#{term}です")
    sentence_reading = punctuation("#{reading}です")
    cloze = 'これは＿＿です。'
  else
    text = punctuation("#{term}です")
    sentence_reading = punctuation("#{reading}です")
    cloze = '＿＿です。'
  end

  {
    id: format('s-%02d-%02d', lesson, sequence),
    lessonId: format('lesson-%02d', lesson),
    text: text,
    reading: sentence_reading,
    meaning: punctuation(meaning),
    clozeText: cloze,
    answers: [term, reading].uniq,
    vocabularyIds: [item['id']],
    source: 'generated'
  }
end

vocabulary = JSON.parse(File.read(VOCABULARY_FILE))
sentences = []
report = { lessons: {}, total: 0 }

(11..50).each do |lesson|
  candidates = vocabulary
    .select { |item| item['sourceLesson'].to_i == lesson && usable?(item) }
    .sort_by { |item| [priority(item), item['sourceSequence'].to_i] }
    .first(10)

  raise "第 #{lesson} 课可用词条不足10条" if candidates.length < 10

  generated = candidates.each_with_index.map { |item, index| build_sentence(item, lesson, index + 1) }
  sentences.concat(generated)
  report[:lessons][lesson.to_s] = generated.map { |item| { id: item[:id], text: item[:text], vocabularyIds: item[:vocabularyIds] } }
end

report[:total] = sentences.length
File.write(OUTPUT_FILE, JSON.pretty_generate(sentences))
File.write(REPORT_FILE, JSON.pretty_generate(report))
puts "已生成 #{sentences.length} 条短句，覆盖第11-50课"
