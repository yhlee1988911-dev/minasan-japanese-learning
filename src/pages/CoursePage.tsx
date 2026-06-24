import { ArrowRight, MessageSquareText, Rows3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { lessons } from '../data/catalog';

export function CoursePage() {
  return (
    <main className="content-section page-section">
      <div className="page-heading"><p className="eyebrow">COURSE PATH</p><h1>初级课程</h1><p>先认识词汇，再进入短句，最后完成本课练习。</p></div>
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
    </main>
  );
}
