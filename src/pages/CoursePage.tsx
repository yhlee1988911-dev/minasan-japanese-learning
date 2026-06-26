import { ArrowRight, MessageSquareText, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { lessons } from '../data/catalog';
import type { Lesson } from '../domain/models';
import { loadDuolingoCourse, onVisible } from '../services/api';

export function CoursePage() {
  const [duolingoLessons, setDuolingoLessons] = useState<Lesson[]>([]);

  useEffect(() => {
    const refresh = () => {
      loadDuolingoCourse().then(data => setDuolingoLessons(data.lessons));
    };
    refresh();
    return onVisible(refresh);
  }, []);

  return (
    <main className="content-section page-section">
      <div className="page-heading"><p className="eyebrow">COURSE PATH</p><h1>课程选择</h1><p>初级日语 50 课保持原课程内容，duolingo 作为独立词汇课程练习。</p></div>
      <div className="course-columns">
        <section>
          <div className="section-title"><h2>初级日语 50 课</h2><span>{lessons.length} 课</span></div>
          <div className="lesson-list">
            {lessons.map(lesson => (
              <article className="lesson-row" key={lesson.id}>
                <span className="lesson-order">{String(lesson.order).padStart(2, '0')}</span>
                <div><h2>{lesson.title}</h2><p>{lesson.description}</p></div>
                <div className="lesson-counts"><span><Rows3 size={15} />{lesson.vocabularyIds.length} 词</span><span><MessageSquareText size={15} />{lesson.sentenceIds.length} 句</span></div>
                {lesson.vocabularyIds.length ? <Link to={`/lesson/${lesson.id}`}>进入课程 <ArrowRight size={17} /></Link> : <span className="pending">待导入</span>}
              </article>
            ))}
          </div>
        </section>
        <section>
          <div className="section-title"><h2>duolingo</h2><span>{duolingoLessons.length} 课</span></div>
          <div className="lesson-list lesson-list--duolingo">
            {duolingoLessons.map(lesson => (
              <article className="lesson-row" key={lesson.id}>
                <span className="lesson-order">{String(lesson.order).padStart(2, '0')}</span>
                <div><h2>{lesson.title}</h2><p>{lesson.description}</p></div>
                <div className="lesson-counts"><span><Rows3 size={15} />{lesson.vocabularyIds.length} 词</span><span><MessageSquareText size={15} />0 句</span></div>
                <Link to={`/practice?mode=translation&lesson=${lesson.id}`}>进入练习 <ArrowRight size={17} /></Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
