import { ArrowRight, BookMarked, BookOpenText, Headphones, Languages, Sparkles, TextCursorInput } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { course } from '../data/catalog';
import { loadDuolingoCourse, onVisible } from '../services/api';
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
  const [duolingoTotal, setDuolingoTotal] = useState(0);

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
      loadDuolingoCourse()
        .then(data => setDuolingoTotal(data.vocabulary.length))
        .catch(() => setDuolingoTotal(0));
    };
    refresh();
    return onVisible(refresh);
  }, []);

  const duolingoMastered = useMemo(() => {
    return readMastery().filter(record => (
      record.kind === 'vocabulary'
      && record.courseId === 'duolingo'
      && isMastered(record)
    )).length;
  }, [masteryVersion]);

  const duolingoProgress = duolingoTotal
    ? Math.round((duolingoMastered / duolingoTotal) * 100)
    : 0;
  const duolingoMistakes = useMemo(() => {
    return readMistakes().filter(record => record.lessonId.startsWith('duolingo-')).length;
  }, [mistakeVersion]);

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

      <Link className="mastery-progress mastery-progress--link" to="/mastery/vocabulary" aria-label="进入 Duolingo 已掌握词库">
        <div className="mastery-progress__heading">
          <span>Duolingo 词汇掌握进度</span>
          <strong>{duolingoMastered} / {duolingoTotal}</strong>
        </div>
        <div className="mastery-progress__row mastery-progress__row--duolingo">
          <span>词库</span>
          <div className="mastery-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={duolingoProgress}>
            <div style={{ width: `${duolingoProgress}%` }} />
          </div>
          <strong>{duolingoProgress}%</strong>
        </div>
        <p>{duolingoMastered === 0 ? '单词在 6 秒内首次答对，即可点亮词汇进度。' : '点击查看 Duolingo 已掌握词库。'}</p>
      </Link>

      <section className="review-entry">
        <div><BookMarked size={22} /><span><strong>错题本</strong><small>仅统计 Duolingo 词库错题</small></span></div>
        <b>{duolingoMistakes}</b>
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
