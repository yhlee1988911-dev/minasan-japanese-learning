import { ArrowRight, BookMarked, CheckCircle2, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sendRemoveMistake } from '../services/api';
import { readMistakes, removeMistake, type MistakeRecord } from '../storage/mistakes';

const PAGE_SIZE = 15;

export function ReviewPage() {
  const [mistakes, setMistakes] = useState<MistakeRecord[]>(readMistakes);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const refresh = () => setMistakes(readMistakes());
    window.addEventListener('minasan:mistakes-changed', refresh);
    return () => window.removeEventListener('minasan:mistakes-changed', refresh);
  }, []);

  const filteredMistakes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return mistakes.slice(0, PAGE_SIZE);
    return mistakes.filter(item => [
      item.prompt,
      item.meaning,
      item.speech,
      item.answers.join(' / '),
      item.lessonId,
      item.courseId
    ].some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [mistakes, search]);

  const removeItem = (key: string) => {
    removeMistake(key);
    void sendRemoveMistake(key).catch(() => undefined);
    setMistakes(readMistakes());
  };

  return (
    <main className="content-section page-section review-page">
      <div className="page-heading">
        <p className="eyebrow">REVIEW NOTEBOOK</p>
        <h1>错题本</h1>
        <p>这里显示当前账户在各课件练习中的错题。巩固练习中答对后自动消除。</p>
      </div>

      <section className="mastery-toolbar review-toolbar" aria-label="错题搜索">
        <label>
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索错题、答案、释义" />
        </label>
        <strong>{search.trim() ? `${filteredMistakes.length} 条结果` : `${Math.min(mistakes.length, PAGE_SIZE)} / ${mistakes.length}`}</strong>
        <Link className="review-practice-link" to="/practice?review=true"><BookMarked size={16} />开始巩固 <ArrowRight size={16} /></Link>
      </section>

      {filteredMistakes.length ? (
        <div className="mastery-list">
          {filteredMistakes.map(item => (
            <article className="mastery-list__item review-list__item" key={item.key}>
              <CheckCircle2 size={20} />
              <div>
                <strong>{item.prompt}</strong>
                <span>{item.answers.join(' / ')} · {item.meaning} · 错误 {item.wrongCount} 次</span>
              </div>
              <button type="button" onClick={() => removeItem(item.key)}><Trash2 size={16} />移除</button>
            </article>
          ))}
        </div>
      ) : (
        <section className="mastery-empty review-empty">
          <CheckCircle2 size={38} />
          <p>{search.trim() ? '没有找到匹配的错题。' : '当前没有错题。'}</p>
        </section>
      )}
    </main>
  );
}
