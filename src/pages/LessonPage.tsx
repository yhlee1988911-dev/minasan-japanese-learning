import { Headphones, MessageSquareText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { lessons, sentences, vocabulary } from '../data/catalog';

export function LessonPage() {
  const { lessonId } = useParams();
  const lesson = lessons.find(item => item.id === lessonId) || lessons[0];
  const words = vocabulary.filter(item => lesson.vocabularyIds.includes(item.id));
  const lessonSentences = sentences.filter(item => lesson.sentenceIds.includes(item.id));

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  return (
    <main className="content-section page-section">
      <div className="page-heading"><p className="eyebrow">LESSON {lesson.order}</p><h1>{lesson.title}</h1><p>{lesson.description}</p></div>
      <div className="lesson-tabs" aria-label="课程内容"><a href="#words">词汇</a><a href="#sentences">短句</a><Link to={`/practice?lesson=${lesson.id}&mode=translation`}>练习</Link></div>
      <section id="words"><div className="section-title"><h2>词汇</h2><span>{words.length} 个</span></div>
        <div className="word-list">{words.map(word => <article className="word-card" key={word.id}>
          <div className="word-card__term"><strong>{word.term}</strong><span>{word.reading}</span></div>
          <p>{word.meanings.join('；')}</p>
          <div className="word-card__tags">
            {word.accentDisplay && <small className="word-tag word-tag--accent">{word.accentDisplay}</small>}
            {word.partOfSpeech && word.partOfSpeech !== '未分类' && <small className="word-tag word-tag--pos">{word.partOfSpeech}</small>}
          </div>
          <button type="button" title="播放发音" onClick={() => speak(word.reading)}><Headphones size={18} /></button>
        </article>)}</div>
      </section>
      <section id="sentences"><div className="section-title"><MessageSquareText size={20} /><h2>短句</h2><span>{lessonSentences.length} 句</span></div>
        <div className="sentence-list">{lessonSentences.map(sentence => <article key={sentence.id}><strong>{sentence.text}</strong><span>{sentence.reading}</span><p>{sentence.meaning}</p><button type="button" title="播放短句" onClick={() => speak(sentence.reading)}><Headphones size={18} /></button></article>)}</div>
      </section>
    </main>
  );
}
