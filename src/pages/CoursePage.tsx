import { ArrowRight, Rows3 } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCourseTitle, getSystemDisplayLesson } from '../domain/catalogDisplay';
import type { CatalogPayload } from '../services/api';
import { loadCatalog, onVisible } from '../services/api';

const COURSE_TONES = [
  { bg: '#f2f7f1', border: '#b8cdb1', accent: '#6f965f', button: '#7faa6f', buttonShadow: '#668b5a', eyeBg: 'rgba(116, 138, 107, 0.18)', eyeBorder: 'rgba(155, 174, 145, 0.42)', eyeAccent: '#a8b89e', eyeButton: '#6d7f68' },
  { bg: '#f0f5f7', border: '#aac5ce', accent: '#5f8da0', button: '#6c9bad', buttonShadow: '#557f8f', eyeBg: 'rgba(96, 126, 138, 0.18)', eyeBorder: 'rgba(142, 166, 174, 0.42)', eyeAccent: '#9fb7bf', eyeButton: '#627982' },
  { bg: '#f7f2f4', border: '#d1b3bc', accent: '#9b6c7a', button: '#aa7887', buttonShadow: '#8b6370', eyeBg: 'rgba(137, 103, 113, 0.18)', eyeBorder: 'rgba(177, 148, 156, 0.42)', eyeAccent: '#c0a5ad', eyeButton: '#806b72' },
  { bg: '#f7f4ec', border: '#d1c09b', accent: '#947e50', button: '#a38b58', buttonShadow: '#837048', eyeBg: 'rgba(134, 117, 79, 0.18)', eyeBorder: 'rgba(174, 158, 120, 0.42)', eyeAccent: '#c0b08b', eyeButton: '#7e745d' },
  { bg: '#f4f2f8', border: '#beb6cf', accent: '#7e719c', button: '#8d7fad', buttonShadow: '#71678e', eyeBg: 'rgba(115, 104, 140, 0.18)', eyeBorder: 'rgba(157, 148, 178, 0.42)', eyeAccent: '#afa5c4', eyeButton: '#736b84' },
  { bg: '#eff6f4', border: '#a9c7bf', accent: '#5d917f', button: '#6aa08f', buttonShadow: '#547f72', eyeBg: 'rgba(93, 129, 117, 0.18)', eyeBorder: 'rgba(139, 166, 157, 0.42)', eyeAccent: '#9db9b0', eyeButton: '#647a73' }
] as const;

const courseToneStyle = (index: number) => {
  const tone = COURSE_TONES[index % COURSE_TONES.length];
  return {
    '--course-bg': tone.bg,
    '--course-border': tone.border,
    '--course-accent': tone.accent,
    '--course-button': tone.button,
    '--course-button-shadow': tone.buttonShadow,
    '--course-eye-bg': tone.eyeBg,
    '--course-eye-border': tone.eyeBorder,
    '--course-eye-accent': tone.eyeAccent,
    '--course-eye-button': tone.eyeButton
  } as CSSProperties;
};

export function CoursePage() {
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

  const grouped = useMemo(() => catalog.courses.map(course => {
    const lessons = course.isSystem
      ? [getSystemDisplayLesson(catalog, course)]
      : catalog.lessons.filter(lesson => lesson.courseId === course.id);
    const vocabularyCount = catalog.vocabulary.filter(word => word.courseId === course.id).length;
    return { course, lessons, vocabularyCount };
  }), [catalog]);

  return (
    <main className="content-section page-section">
      <div className="page-heading">
        <p className="eyebrow">COURSE PATH</p>
        <h1>课程选择</h1>
        <p>系统默认词库和用户自定义课件都从本地 SQL 目录读取，学习进度按课件独立保存。</p>
      </div>
      {error && <p className="admin-error">{error}</p>}
      <div className="course-grid">
        {grouped.map(({ course, lessons, vocabularyCount }, index) => (
          <section className="course-group" key={course.id} style={courseToneStyle(index)}>
            <div className="section-title">
              <h2>{getCourseTitle(course)}</h2>
              <span>{vocabularyCount} 词</span>
            </div>
            <div className="course-lesson-grid">
              {lessons.map(lesson => {
                const wordCount = lesson.vocabularyIds.length;
                return (
                  <article className="course-lesson-card" key={lesson.id}>
                    <span className="lesson-order">{course.isSystem ? 'N' : String(lesson.order).padStart(2, '0')}</span>
                    <div><h2>{lesson.title}</h2><p>{lesson.description}</p></div>
                    <div className="lesson-counts"><span><Rows3 size={15} />{wordCount} 词</span></div>
                    {wordCount ? <Link to={course.isSystem ? `/course/${course.id}/lesson/all` : `/course/${course.id}/lesson/${lesson.id}`}>进入课程 <ArrowRight size={17} /></Link> : <span className="pending">待导入</span>}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {!grouped.length && <p className="pending">正在读取课程目录</p>}
      </div>
    </main>
  );
}
