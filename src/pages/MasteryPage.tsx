import { ArrowLeft, CheckCircle2, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Vocabulary } from '../domain/models';
import { loadDuolingoCourse, sendRemoveMastery } from '../services/api';
import { isMastered, readMastery, removeMasteryRecord } from '../storage/mastery';

const PAGE_SIZE = 15;

export function MasteryPage() {
  const [version, setVersion] = useState(0);
  const [duolingoVocabulary, setDuolingoVocabulary] = useState<Vocabulary[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadDuolingoCourse()
      .then(data => setDuolingoVocabulary(data.vocabulary))
      .catch(() => setDuolingoVocabulary([]));
  }, []);

  const masteredWords = useMemo(() => {
    const masteredIds = new Set(readMastery().filter(record => (
      record.kind === 'vocabulary'
      && record.courseId === 'duolingo'
      && isMastered(record)
    )).map(record => record.id));
    return duolingoVocabulary.filter(word => masteredIds.has(word.id));
  }, [duolingoVocabulary, version]);

  const filteredWords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return masteredWords.slice(0, PAGE_SIZE);
    return masteredWords.filter(word => [
      word.term,
      word.reading,
      word.romaji,
      word.meanings.join('；'),
      word.sourceLessonLabel || word.sourceLesson
    ].some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [masteredWords, search]);

  const removeWord = (word: Vocabulary) => {
    const removed = removeMasteryRecord('vocabulary', word.id);
    const lessonId = removed?.lessonId || word.sourceLesson;
    void sendRemoveMastery({
      id: word.id,
      lessonId,
      courseId: 'duolingo',
      kind: 'vocabulary'
    }).catch(() => undefined);
    setVersion(value => value + 1);
  };

  return (
    <main className="content-section page-section mastery-page">
      <div className="page-heading">
        <Link className="back-link" to="/"><ArrowLeft size={17} />返回首页</Link>
        <p className="eyebrow">DUOLINGO MASTERED WORDS</p>
        <h1>已掌握词库</h1>
        <p>这里仅显示 Duolingo 词库中已掌握的词条。默认显示 15 条，可通过搜索定位具体词汇。</p>
      </div>

      <section className="mastery-toolbar" aria-label="已掌握词库搜索">
        <label>
          <Search size={17} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索日文、假名、释义、罗马音" />
        </label>
        <strong>{search.trim() ? `${filteredWords.length} 条结果` : `${Math.min(masteredWords.length, PAGE_SIZE)} / ${masteredWords.length}`}</strong>
      </section>

      {filteredWords.length ? (
        <div className="mastery-list">
          {filteredWords.map(word => (
            <article className="mastery-list__item" key={word.id}>
              <CheckCircle2 size={20} />
              <div>
                <strong>{word.term}</strong>
                <span>{word.reading} · {word.romaji || '无罗马音'} · {word.meanings.join('；')}</span>
              </div>
              <button type="button" onClick={() => removeWord(word)}><Trash2 size={16} />移除</button>
            </article>
          ))}
        </div>
      ) : (
        <section className="mastery-empty">
          <CheckCircle2 size={34} />
          <p>{search.trim() ? '没有找到匹配的已掌握词条。' : '还没有 Duolingo 已掌握词汇。'}</p>
        </section>
      )}
    </main>
  );
}
