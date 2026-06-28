import { ArrowRight, BookMarked, BookOpenText, Headphones, Languages, Sparkles, TextCursorInput } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCourseTitle } from '../domain/catalogDisplay';
import type { CatalogPayload } from '../services/api';
import { loadCatalog, onVisible } from '../services/api';
import { isMastered, readMastery } from '../storage/mastery';
import { readMistakes } from '../storage/mistakes';

const modes = [
  { id: 'dictation', title: '随课听写训练', text: '按所选课程播放日语发音，输入对应词汇。', icon: Headphones },
  { id: 'translation', title: '随课翻译训练', text: '按所选课程根据中文释义写出日文。', icon: Languages },
  { id: 'cloze', title: '短句填空', text: '在语境中补全缺失词汇。', icon: TextCursorInput },
  { id: 'basic', title: '基础训练', text: '平假名、片假名、拗音随进随学。', icon: Sparkles }
];

export function HomePage() {
  const [masteryVersion, setMasteryVersion] = useState(0);
  const [mistakeVersion, setMistakeVersion] = useState(0);
  const [catalog, setCatalog] = useState<CatalogPayload>({ courses: [], lessons: [], vocabulary: [], sentences: [] });

  useEffect(() => {
    const refreshMastery = () => setMasteryVersion(version => version + 1);
    window.addEventListener('minasan:mastery-changed', refreshMastery);
    return () => window.removeEventListener('minasan:mastery-changed', refreshMastery);
  }, []);

  useEffect(() => {
    const refreshMistakes = () => setMistakeVersion(version => version + 1);
    window.addEventListener('minasan:mistakes-changed', refreshMistakes);
    return () => window.removeEventListener('minasan:mistakes-changed', refreshMistakes);
  }, []);

  useEffect(() => {
    const refresh = () => {
      loadCatalog()
        .then(setCatalog)
        .catch(() => setCatalog({ courses: [], lessons: [], vocabulary: [], sentences: [] }));
    };
    refresh();
    return onVisible(refresh);
  }, []);

  const courseProgress = useMemo(() => {
    const visibleIds = new Set(catalog.vocabulary.map(word => word.id));
    const masteredIds = new Set(readMastery().filter(record => (
      record.kind === 'vocabulary'
      && visibleIds.has(record.id)
      && isMastered(record)
    )).map(record => record.id));

    return catalog.courses.map(course => {
      const words = catalog.vocabulary.filter(word => word.courseId === course.id);
      const mastered = words.filter(word => masteredIds.has(word.id)).length;
      const total = words.length;
      return {
        course,
        mastered,
        total,
        progress: total ? Math.round((mastered / total) * 100) : 0
      };
    }).filter(item => item.total > 0);
  }, [catalog.courses, catalog.vocabulary, masteryVersion]);

  const totalVocabulary = courseProgress.reduce((sum, item) => sum + item.total, 0);
  const masteredCount = courseProgress.reduce((sum, item) => sum + item.mastered, 0);
  const mistakeCount = useMemo(() => readMistakes().length, [mistakeVersion]);

  return (
    <main>
      <section className="overview-band">
        <div>
          <p className="eyebrow">VOCABULARY MEMORY ENGINE</p>
          <h1>日语词汇记忆引擎</h1>
          <p>系统提供词汇记忆、听写、翻译和复习引擎；公共开源词库与用户自定义课件均以 SQL 目录保存，学习记录按用户独立同步。</p>
        </div>
        <Link className="primary-command" to="/course">继续学习 <ArrowRight size={18} /></Link>
      </section>

      <Link className="mastery-progress mastery-progress--link" to="/mastery/vocabulary" aria-label="进入已掌握词库">
        <div className="mastery-progress__heading">
          <span>词汇掌握进度</span>
          <strong>{masteredCount} / {totalVocabulary}</strong>
        </div>
        <div className="mastery-progress__rows">
          {courseProgress.length ? courseProgress.map(({ course, mastered, total, progress }) => (
            <div className="mastery-progress__row mastery-progress__row--course" key={course.id}>
              <span title={getCourseTitle(course)}>{getCourseTitle(course)}</span>
              <div className="mastery-progress__track" role="progressbar" aria-label={`${getCourseTitle(course)} ${mastered}/${total}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div style={{ width: `${progress}%` }} />
              </div>
              <strong>{mastered}/{total}</strong>
            </div>
          )) : (
            <div className="mastery-progress__row mastery-progress__row--course">
              <span>词库</span>
              <div className="mastery-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
                <div style={{ width: '0%' }} />
              </div>
              <strong>0/0</strong>
            </div>
          )}
        </div>
        <p>{masteredCount === 0 ? '单词在 6 秒内首次答对，即可计入已掌握词汇。' : '点击查看已掌握词库。'}</p>
      </Link>

      <section className="review-entry">
        <div><BookMarked size={22} /><span><strong>错题本</strong><small>按用户和课件独立保存</small></span></div>
        <b>{mistakeCount}</b>
        <Link to="/review">进入错题本 <ArrowRight size={16} /></Link>
      </section>

      <section className="content-section">
        <div className="section-title"><BookOpenText size={20} /><h2>日语随课词汇训练</h2></div>
        <div className="mode-grid">
          {modes.map(({ id, title, text, icon: Icon }) => (
            <Link className="mode-card" key={id} to={id === 'basic' ? '/basic' : `/practice?mode=${id}`}>
              <Icon size={24} /><h3>{title}</h3><p>{text}</p><span>开始练习 <ArrowRight size={16} /></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
