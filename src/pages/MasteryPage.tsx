import { ArrowLeft, BookOpenText, CheckCircle2, MessageSquareText, Rows3, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { lessons, sentences, vocabulary } from '../data/catalog';
import { isMastered, readMastery, removeMasteryRecord, type MasteryKind } from '../storage/mastery';

type MasteryView = 'courses' | 'vocabulary' | 'sentences';

const viewMeta: Record<MasteryView, { title: string; eyebrow: string; empty: string }> = {
  courses: {
    title: '已掌握课程',
    eyebrow: 'MASTERED LESSONS',
    empty: '还没有完整掌握的课程。'
  },
  vocabulary: {
    title: '已掌握词汇',
    eyebrow: 'MASTERED WORDS',
    empty: '还没有达到掌握标准的词汇。'
  },
  sentences: {
    title: '已掌握短句',
    eyebrow: 'MASTERED SENTENCES',
    empty: '还没有达到掌握标准的短句。'
  }
};

const getLessonTitle = (lessonId: string) => lessons.find(lesson => lesson.id === lessonId)?.title || lessonId;
const getVocabularyLessonTitle = (sourceLesson: string) => {
  const order = Number(sourceLesson.replace('补充', ''));
  if (!Number.isFinite(order)) return sourceLesson;
  return getLessonTitle(`lesson-${String(order).padStart(2, '0')}`);
};

export function MasteryPage() {
  const { view = 'vocabulary' } = useParams();
  const activeView = (['courses', 'vocabulary', 'sentences'].includes(view) ? view : 'vocabulary') as MasteryView;
  const [version, setVersion] = useState(0);

  const mastery = useMemo(() => {
    const records = readMastery();
    const masteredVocabularyIds = new Set(records.filter(record => record.kind === 'vocabulary' && isMastered(record)).map(record => record.id));
    const masteredSentenceIds = new Set(records.filter(record => record.kind === 'sentence' && isMastered(record)).map(record => record.id));

    return {
      vocabulary: vocabulary.filter(item => masteredVocabularyIds.has(item.id)),
      sentences: sentences.filter(item => masteredSentenceIds.has(item.id)),
      courses: lessons.filter(lesson => {
        const contentIds = [...lesson.vocabularyIds, ...lesson.sentenceIds];
        return contentIds.length > 0
          && lesson.vocabularyIds.every(id => masteredVocabularyIds.has(id))
          && lesson.sentenceIds.every(id => masteredSentenceIds.has(id));
      })
    };
  }, [version]);

  const removeItem = (kind: MasteryKind, id: string) => {
    removeMasteryRecord(kind, id);
    setVersion(value => value + 1);
  };

  const meta = viewMeta[activeView];

  return (
    <main className="content-section page-section mastery-page">
      <div className="page-heading">
        <Link className="back-link" to="/"><ArrowLeft size={17} />返回首页</Link>
        <p className="eyebrow">{meta.eyebrow}</p>
        <h1>{meta.title}</h1>
        <p>如果太久没有温习，可以移出已掌握区域，重新进入练习巩固。</p>
      </div>

      <nav className="mastery-tabs" aria-label="已掌握分类">
        <Link className={activeView === 'courses' ? 'active' : ''} to="/mastery/courses"><BookOpenText size={17} />课程</Link>
        <Link className={activeView === 'vocabulary' ? 'active' : ''} to="/mastery/vocabulary"><Rows3 size={17} />词汇</Link>
        <Link className={activeView === 'sentences' ? 'active' : ''} to="/mastery/sentences"><MessageSquareText size={17} />短句</Link>
      </nav>

      {activeView === 'courses' && (
        mastery.courses.length ? (
          <div className="mastery-list">
            {mastery.courses.map(lesson => (
              <article className="mastery-list__item" key={lesson.id}>
                <CheckCircle2 size={20} />
                <div><strong>第 {lesson.order} 课 · {lesson.title}</strong><span>{lesson.vocabularyIds.length} 词 · {lesson.sentenceIds.length} 句</span></div>
                <Link to={`/lesson/${lesson.id}`}>查看</Link>
              </article>
            ))}
          </div>
        ) : <section className="mastery-empty"><CheckCircle2 size={34} /><p>{meta.empty}</p></section>
      )}

      {activeView === 'vocabulary' && (
        mastery.vocabulary.length ? (
          <div className="mastery-list">
            {mastery.vocabulary.map(word => (
              <article className="mastery-list__item" key={word.id}>
                <CheckCircle2 size={20} />
                <div><strong>{word.term}</strong><span>{word.reading} · {word.meanings.join('；')} · {getVocabularyLessonTitle(word.sourceLesson)}</span></div>
                <button type="button" onClick={() => removeItem('vocabulary', word.id)}><Trash2 size={16} />移除</button>
              </article>
            ))}
          </div>
        ) : <section className="mastery-empty"><CheckCircle2 size={34} /><p>{meta.empty}</p></section>
      )}

      {activeView === 'sentences' && (
        mastery.sentences.length ? (
          <div className="mastery-list">
            {mastery.sentences.map(sentence => (
              <article className="mastery-list__item" key={sentence.id}>
                <CheckCircle2 size={20} />
                <div><strong>{sentence.text}</strong><span>{sentence.reading} · {sentence.meaning} · {getLessonTitle(sentence.lessonId)}</span></div>
                <button type="button" onClick={() => removeItem('sentence', sentence.id)}><Trash2 size={16} />移除</button>
              </article>
            ))}
          </div>
        ) : <section className="mastery-empty"><CheckCircle2 size={34} /><p>{meta.empty}</p></section>
      )}
    </main>
  );
}
