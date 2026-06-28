import { ArrowLeft, Headphones, MessageSquareText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCourseTitle, getSystemDisplayLesson, SYSTEM_COURSE_ID } from '../domain/catalogDisplay';
import type { CatalogPayload } from '../services/api';
import { loadCatalog, onVisible } from '../services/api';
import { speakJapanese } from '../services/speech';

export function LessonPage() {
  const { courseId = '', lessonId = '' } = useParams();
  const [catalog, setCatalog] = useState<CatalogPayload>({ courses: [], lessons: [], vocabulary: [], sentences: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => {
      loadCatalog()
        .then(data => {
          setCatalog(data);
          setError('');
        })
        .catch(err => setError(err instanceof Error ? err.message : '课程读取失败'));
    };
    refresh();
    return onVisible(refresh);
  }, []);

  const course = useMemo(() => (
    catalog.courses.find(item => item.id === courseId)
    || catalog.courses.find(item => item.id === SYSTEM_COURSE_ID)
    || catalog.courses[0]
  ), [catalog.courses, courseId]);
  const lesson = useMemo(() => {
    if (course?.isSystem || course?.id === SYSTEM_COURSE_ID || lessonId === 'all') {
      return course ? getSystemDisplayLesson(catalog, course) : null;
    }
    return (
      catalog.lessons.find(item => item.id === lessonId && (!courseId || item.courseId === courseId))
      || catalog.lessons.find(item => item.id === lessonId)
      || catalog.lessons[0]
    );
  }, [catalog, course, courseId, lessonId]);
  const words = useMemo(() => lesson ? catalog.vocabulary.filter(item => lesson.vocabularyIds.includes(item.id)) : [], [catalog.vocabulary, lesson]);
  const lessonSentences = useMemo(() => lesson ? catalog.sentences.filter(item => lesson.sentenceIds.includes(item.id)) : [], [catalog.sentences, lesson]);

  if (error) {
    return <main className="content-section page-section"><div className="page-heading"><Link className="back-link" to="/course"><ArrowLeft size={17} />返回课程</Link><h1>课程读取失败</h1><p>{error}</p></div></main>;
  }

  if (!lesson) {
    return <main className="content-section page-section"><div className="page-heading"><Link className="back-link" to="/course"><ArrowLeft size={17} />返回课程</Link><h1>正在读取课程</h1></div></main>;
  }

  return (
    <main className="content-section page-section">
      <div className="page-heading">
        <Link className="back-link" to="/course"><ArrowLeft size={17} />返回课程</Link>
        <p className="eyebrow">{getCourseTitle(course) || 'COURSE'}</p>
        <h1>{lesson.title}</h1>
        <p>{lesson.description}</p>
      </div>
      <div className="lesson-tabs" aria-label="课程内容">
        <a href="#words">词汇</a>
        {lessonSentences.length > 0 && <a href="#sentences">短句</a>}
        <Link to={`/practice?course=${lesson.courseId}&lesson=${lesson.id}&mode=translation`}>翻译练习</Link>
        <Link to={`/practice?course=${lesson.courseId}&lesson=${lesson.id}&mode=dictation`}>听写练习</Link>
      </div>
      <section id="words">
        <div className="section-title"><h2>词汇</h2><span>{words.length} 个</span></div>
        <div className="word-list">{words.map(word => <article className="word-card" key={word.id}>
          <div className="word-card__term"><strong>{word.term}</strong><span>{word.reading}</span></div>
          <p>{word.meanings.join('；')}</p>
          <div className="word-card__tags">
            {word.romaji && <small className="word-tag word-tag--accent">{word.romaji}</small>}
            {word.accentDisplay && <small className="word-tag word-tag--accent">{word.accentDisplay}</small>}
            {word.partOfSpeech && word.partOfSpeech !== '未分类' && <small className="word-tag word-tag--pos">{word.partOfSpeech}</small>}
          </div>
          <button type="button" title="播放发音" onClick={() => void speakJapanese(word.reading)}><Headphones size={18} /></button>
        </article>)}</div>
      </section>
      {lessonSentences.length > 0 && (
        <section id="sentences">
          <div className="section-title"><MessageSquareText size={20} /><h2>短句</h2><span>{lessonSentences.length} 句</span></div>
          <div className="sentence-list">{lessonSentences.map(sentence => <article key={sentence.id}><strong>{sentence.text}</strong><span>{sentence.reading}</span><p>{sentence.meaning}</p><button type="button" title="播放短句" onClick={() => void speakJapanese(sentence.reading)}><Headphones size={18} /></button></article>)}</div>
        </section>
      )}
    </main>
  );
}
