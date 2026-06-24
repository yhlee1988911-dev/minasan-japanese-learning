import { ArrowRight, BookMarked, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { readMistakes, type MistakeRecord } from '../storage/mistakes';

export function ReviewPage() {
  const [mistakes, setMistakes] = useState<MistakeRecord[]>(readMistakes);

  useEffect(() => {
    const refresh = () => setMistakes(readMistakes());
    window.addEventListener('minasan:mistakes-changed', refresh);
    return () => window.removeEventListener('minasan:mistakes-changed', refresh);
  }, []);

  return (
    <main className="content-section page-section review-page">
      <div className="page-heading">
        <p className="eyebrow">REVIEW NOTEBOOK</p>
        <h1>错题本</h1>
        <p>答错的词汇和短句会保存在本机。巩固练习中答对后自动消除。</p>
      </div>

      {mistakes.length ? (
        <>
          <div className="review-summary">
            <div><BookMarked size={22} /><span>待巩固</span><strong>{mistakes.length}</strong></div>
            <Link to="/practice?review=true">开始巩固 <ArrowRight size={18} /></Link>
          </div>
          <div className="mistake-list">
            {mistakes.map(item => (
              <article key={item.key}>
                <div><strong>{item.prompt}</strong><span>{item.meaning}</span></div>
                <small>{item.answers.join(' / ')}</small>
                <em>错误 {item.wrongCount} 次</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <section className="review-empty">
          <CheckCircle2 size={38} />
          <h2>当前没有错题</h2>
          <p>继续练习，新的错题会自动收集在这里。</p>
          <Link to="/">返回首页</Link>
        </section>
      )}
    </main>
  );
}
