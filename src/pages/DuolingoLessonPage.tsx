import { ArrowLeft, Headphones, Rows3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Lesson, Vocabulary } from '../domain/models';
import { loadDuolingoCourse, onVisible } from '../services/api';
import { speakJapanese } from '../services/speech';

export function DuolingoLessonPage() {
  const { lessonId = '' } = useParams();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);

  useEffect(() => {
    const refresh = () => loadDuolingoCourse().then(data => {
      setLessons(data.lessons);
      setVocabulary(data.vocabulary);
    });
    refresh();
    return onVisible(refresh);
  }, []);

  const lesson = useMemo(() => (
    lessons.find(item => item.id === lessonId) || lessons[0]
  ), [lessonId, lessons]);
  const words = useMemo(() => (
    lesson ? vocabulary.filter(item => lesson.vocabularyIds.includes(item.id)) : []
  ), [lesson, vocabulary]);

  if (!lesson) {
    return (
      <main className="content-section page-section">
        <div className="page-heading">
          <Link className="back-link" to="/course"><ArrowLeft size={17} />返回课程</Link>
          <p className="eyebrow">DUOLINGO</p>
          <h1>正在读取词表</h1>
          <p>如果长时间没有显示，请返回课程页重新进入。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="content-section page-section">
      <div className="page-heading">
        <Link className="back-link" to="/course"><ArrowLeft size={17} />返回课程</Link>
        <p className="eyebrow">DUOLINGO LESSON {lesson.order}</p>
        <h1>{lesson.title}</h1>
        <p>{lesson.description}</p>
      </div>
      <div className="lesson-tabs" aria-label="Duolingo 课程内容">
        <a href="#words">词汇</a>
        <Link to={`/practice?lesson=${lesson.id}&mode=translation`}>翻译练习</Link>
        <Link to={`/practice?lesson=${lesson.id}&mode=dictation`}>听写练习</Link>
      </div>
      <section id="words">
        <div className="section-title"><Rows3 size={20} /><h2>词汇</h2><span>{words.length} 个</span></div>
        <div className="word-list">
          {words.map(word => (
            <article className="word-card" key={word.id}>
              <div className="word-card__term"><strong>{word.term}</strong><span>{word.reading}</span></div>
              <p>{word.meanings.join('；')}</p>
              <div className="word-card__tags">
                {word.romaji && <small className="word-tag word-tag--accent">{word.romaji}</small>}
                {word.partOfSpeech && word.partOfSpeech !== '未分类' && <small className="word-tag word-tag--pos">{word.partOfSpeech}</small>}
              </div>
              <button type="button" title="播放发音" onClick={() => void speakJapanese(word.reading)}><Headphones size={18} /></button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
