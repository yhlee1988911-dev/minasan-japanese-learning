import { ArrowRight, BookMarked, BookOpenText, Headphones, Languages, TextCursorInput } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { course, lessons, sentences, vocabulary } from '../data/catalog';
import { isMastered, readMastery } from '../storage/mastery';
import { readMistakes } from '../storage/mistakes';

const modes = [
  { id: 'dictation', title: '听写模式', text: '听日语发音，输入对应词汇。', icon: Headphones },
  { id: 'translation', title: '翻译模式', text: '根据中文意思，写出日文。', icon: Languages },
  { id: 'cloze', title: '短句填空', text: '在语境中补全缺失词汇。', icon: TextCursorInput }
];

export function HomePage() {
  const [mistakeCount, setMistakeCount] = useState(() => readMistakes().length);
  const [masteryVersion, setMasteryVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setMistakeCount(readMistakes().length);
    const refreshMastery = () => setMasteryVersion(version => version + 1);
    window.addEventListener('minasan:mistakes-changed', refresh);
    window.addEventListener('minasan:mastery-changed', refreshMastery);
    return () => {
      window.removeEventListener('minasan:mistakes-changed', refresh);
      window.removeEventListener('minasan:mastery-changed', refreshMastery);
    };
  }, []);

  const mastery = useMemo(() => {
    const records = readMastery();
    const masteredVocabularyIds = new Set(records.filter(record => record.kind === 'vocabulary' && isMastered(record)).map(record => record.id));
    const masteredSentenceIds = new Set(records.filter(record => record.kind === 'sentence' && isMastered(record)).map(record => record.id));
    const masteredCourses = lessons.filter(lesson => {
      const contentIds = [...lesson.vocabularyIds, ...lesson.sentenceIds];
      return contentIds.length > 0
        && lesson.vocabularyIds.every(id => masteredVocabularyIds.has(id))
        && lesson.sentenceIds.every(id => masteredSentenceIds.has(id));
    }).length;
    return {
      courses: masteredCourses,
      vocabulary: masteredVocabularyIds.size,
      sentences: masteredSentenceIds.size
    };
  }, [masteryVersion]);

  const vocabularyProgress = vocabulary.length
    ? Math.round((mastery.vocabulary / vocabulary.length) * 100)
    : 0;

  return (
    <main>
      <section className="overview-band">
        <div>
          <p className="eyebrow">BEGINNER JAPANESE</p>
          <h1>{course.title}</h1>
          <p>{course.description}</p>
        </div>
        <Link className="primary-command" to="/course">继续学习 <ArrowRight size={18} /></Link>
      </section>

      <section className="metrics" aria-label="课程统计">
        <div><span>课程</span><strong>{lessons.length}</strong><small className="mastery-count">已掌握 {mastery.courses}</small></div>
        <div><span>词汇</span><strong>{vocabulary.length}</strong><small className="mastery-count">已掌握 {mastery.vocabulary}</small></div>
        <div><span>短句</span><strong>{sentences.length}</strong><small className="mastery-count">已掌握 {mastery.sentences}</small></div>
      </section>

      <section className="mastery-progress" aria-label="词汇掌握进度">
        <div className="mastery-progress__heading">
          <span>词汇掌握进度</span>
          <strong>{mastery.vocabulary} / {vocabulary.length}</strong>
        </div>
        <div className="mastery-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={vocabularyProgress}>
          <div style={{ width: `${vocabularyProgress}%` }} />
        </div>
        <p>{vocabularyProgress === 0 ? '完成两次无错误作答，点亮第一个词汇进度。' : `已完成 ${vocabularyProgress}%，继续保持。`}</p>
      </section>

      <section className="review-entry">
        <div><BookMarked size={24} /><span><strong>错题本</strong><small>集中巩固练习中答错的内容</small></span></div>
        <b>{mistakeCount}</b>
        <Link to="/review">进入错题本 <ArrowRight size={17} /></Link>
      </section>

      <section className="content-section">
        <div className="section-title"><BookOpenText size={20} /><h2>练习模式</h2></div>
        <div className="mode-grid">
          {modes.map(({ id, title, text, icon: Icon }) => (
            <Link className="mode-card" key={id} to={`/practice?mode=${id}`}>
              <Icon size={24} /><h3>{title}</h3><p>{text}</p><span>开始练习 <ArrowRight size={16} /></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
