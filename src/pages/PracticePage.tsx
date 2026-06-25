import { Check, ChevronDown, Headphones, Home, RotateCcw, SkipForward, Star, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { lessons, sentences, vocabulary } from '../data/catalog';
import type { PracticeMode } from '../domain/models';
import { speakJapanese, stopJapaneseSpeech } from '../services/speech';
import { recordMasteryAttempt } from '../storage/mastery';
import { readMistakes, recordMistake, removeMistake, type MistakeRecord } from '../storage/mistakes';

const modeNames: Record<PracticeMode, string> = {
  dictation: '听写模式',
  translation: '翻译模式',
  cloze: '短句填空'
};

const normalizeAnswer = (value: string) => value
  .normalize('NFC')
  .replace(/[\p{P}\p{S}]/gu, '');

interface PracticeQuestion {
  key: string;
  id: string;
  mode: PracticeMode;
  lessonId: string;
  prompt: string;
  meaning: string;
  speech: string;
  answers: string[];
}

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const getVocabularyLessonId = (sourceLesson: string) => {
  const lesson = lessons.find(item => String(item.order) === sourceLesson.replace('补充', ''));
  return lesson?.id || `lesson-${sourceLesson.padStart(2, '0')}`;
};

const fromMistake = (item: MistakeRecord): PracticeQuestion => ({
  key: item.key,
  id: item.id,
  mode: item.mode,
  lessonId: item.lessonId,
  prompt: item.prompt,
  meaning: item.meaning,
  speech: item.speech,
  answers: item.answers
});

export function PracticePage() {
  const [params] = useSearchParams();
  const requestedMode = (params.get('mode') || 'translation') as PracticeMode;
  const isReview = params.get('review') === 'true';
  const [selectedLessons, setSelectedLessons] = useState(() => new Set([lessons[0].id]));
  const [reviewItems, setReviewItems] = useState<MistakeRecord[]>(readMistakes);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'idle' | 'correct' | 'incorrect'>('idle');
  const [summary, setSummary] = useState({ correct: 0, incorrect: 0, skipped: 0 });
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const referenceTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const feedbackAudioRef = useRef<{ correct: HTMLAudioElement; incorrect: HTMLAudioElement } | null>(null);
  const completionPlayedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  const regularQuestions = useMemo<PracticeQuestion[]>(() => {
    if (requestedMode === 'cloze') {
      return sentences
        .filter(item => selectedLessons.has(item.lessonId))
        .map(item => ({
          key: `${requestedMode}:${item.id}`,
          id: item.id,
          mode: requestedMode,
          lessonId: item.lessonId,
          prompt: item.clozeText,
          meaning: item.meaning,
          speech: item.reading,
          answers: item.answers
        }));
    }

    return vocabulary
      .filter(item => selectedLessons.has(getVocabularyLessonId(item.sourceLesson)))
      .map(item => ({
        key: `${requestedMode}:${item.id}`,
        id: item.id,
        mode: requestedMode,
        lessonId: getVocabularyLessonId(item.sourceLesson),
        prompt: item.meanings[0],
        meaning: item.meanings.join('；'),
        speech: item.reading,
        answers: [item.term, item.reading]
      }));
  }, [requestedMode, selectedLessons]);

  const sourceQuestions = useMemo(
    () => isReview ? reviewItems.map(fromMistake) : regularQuestions,
    [isReview, regularQuestions, reviewItems]
  );

  useEffect(() => {
    setQuestions(shuffle(sourceQuestions));
    setIndex(0);
    setAnswer('');
    setResult('idle');
    setShowReference(false);
    setSummary({ correct: 0, incorrect: 0, skipped: 0 });
    completionPlayedRef.current = false;
  }, [sourceQuestions]);

  const completed = questions.length > 0 && index >= questions.length;
  const current = !completed && questions.length ? questions[index] : null;
  const activeMode = current?.mode || requestedMode;
  const allSelected = selectedLessons.size === lessons.length;
  const selectedLabel = isReview
    ? '错题巩固'
    : allSelected
      ? '初级全部课程'
      : selectedLessons.size === 1
        ? lessons.find(item => selectedLessons.has(item.id))?.title || '第 1 课'
        : `${selectedLessons.size} 个课程`;

  const resetQuestion = useCallback(() => {
    setAnswer('');
    setResult('idle');
    setShowReference(false);
    if (referenceTimerRef.current !== null) {
      window.clearTimeout(referenceTimerRef.current);
      referenceTimerRef.current = null;
    }
  }, []);

  const speak = useCallback(async () => {
    if (!current) return;
    await speakJapanese(current.speech);
  }, [current]);

  const playSyntheticFeedback = (correct: boolean) => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = context;
    void context.resume();
    const now = context.currentTime;
    const notes = correct ? [523.25, 659.25, 783.99] : [170];
    notes.forEach((frequency, noteIndex) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + noteIndex * 0.09;
      const duration = correct ? 0.16 : 0.2;
      oscillator.type = correct ? 'sine' : 'square';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(correct ? 0.0001 : 0.07, start);
      gain.gain.exponentialRampToValueAtTime(correct ? 0.09 : 0.025, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  };

  const playFeedback = (correct: boolean) => {
    if (!feedbackAudioRef.current) {
      feedbackAudioRef.current = {
        correct: new Audio('/sounds/right.wav'),
        incorrect: new Audio('/sounds/wrong.wav')
      };
    }
    const sounds = feedbackAudioRef.current;
    sounds.correct.pause();
    sounds.incorrect.pause();
    const audio = correct ? sounds.correct : sounds.incorrect;
    audio.currentTime = 0;
    audio.volume = 0.78;
    void audio.play().catch(() => playSyntheticFeedback(correct));
  };

  useEffect(() => {
    if (!completed || completionPlayedRef.current) return;
    completionPlayedRef.current = true;
    playFeedback(true);
  }, [completed]);

  useEffect(() => {
    if (!['dictation', 'cloze'].includes(activeMode) || !autoSpeak || !current) return;
    const timer = window.setTimeout(speak, 260);
    return () => window.clearTimeout(timer);
  }, [activeMode, autoSpeak, current, speak]);

  useEffect(() => {
    if (result !== 'correct' || !current) return;
    const timer = window.setTimeout(() => {
      if (isReview) {
        removeMistake(current.key);
        setReviewItems(items => items.filter(item => item.key !== current.key));
      } else {
        setIndex(value => value + 1);
        resetQuestion();
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [current, isReview, questions.length, resetQuestion, result]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const handleResize = () => {
      const open = document.activeElement === inputRef.current && window.innerHeight - viewport.height > 120;
      setKeyboardActive(open);
      if (open) window.setTimeout(() => stageRef.current?.scrollIntoView({ block: 'start' }), 40);
    };
    viewport.addEventListener('resize', handleResize);
    return () => viewport.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => {
    if (referenceTimerRef.current !== null) window.clearTimeout(referenceTimerRef.current);
    stopJapaneseSpeech();
    feedbackAudioRef.current?.correct.pause();
    feedbackAudioRef.current?.incorrect.pause();
    void audioContextRef.current?.close();
  }, []);

  const revealReference = () => {
    setShowReference(true);
    if (referenceTimerRef.current !== null) window.clearTimeout(referenceTimerRef.current);
    referenceTimerRef.current = window.setTimeout(() => {
      setShowReference(false);
      referenceTimerRef.current = null;
    }, 3000);
  };

  const toggleLesson = (lessonId: string) => {
    setSelectedLessons(previous => {
      const next = new Set(previous);
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  };

  const toggleAllLessons = () => {
    setSelectedLessons(allSelected ? new Set() : new Set(lessons.map(item => item.id)));
  };

  const checkAnswer = () => {
    if (!current || !answer.trim() || result === 'correct') return;
    const normalized = normalizeAnswer(answer);
    const correct = current.answers.some(item => normalizeAnswer(item) === normalized);
    setResult(correct ? 'correct' : 'incorrect');
    setSummary(value => ({
      ...value,
      correct: value.correct + (correct ? 1 : 0),
      incorrect: value.incorrect + (correct ? 0 : 1)
    }));
    playFeedback(correct);
    if (!isReview) {
      recordMasteryAttempt({
        id: current.id,
        lessonId: current.lessonId,
        kind: current.id.startsWith('s-') ? 'sentence' : 'vocabulary'
      }, correct);
    }
    if (!correct) {
      recordMistake({
        id: current.id,
        mode: current.mode,
        lessonId: current.lessonId,
        prompt: current.prompt,
        meaning: current.meaning,
        speech: current.speech,
        answers: current.answers
      });
    }
  };

  const skipQuestion = () => {
    setSummary(value => ({ ...value, skipped: value.skipped + 1 }));
    if (questions.length) setIndex(value => value + 1);
    resetQuestion();
  };

  const handleInputFocus = () => {
    setKeyboardActive(true);
    window.setTimeout(() => stageRef.current?.scrollIntoView({ block: 'start' }), 160);
  };

  return (
    <main className={`practice-page ${keyboardActive ? 'practice-page--keyboard' : ''}`}>
      <header className="practice-header">
        <div className="practice-header__left">
          <Link to="/"><Home size={18} />返回首页</Link>
          {['dictation', 'cloze'].includes(activeMode) && !isReview && (
            <label className="header-autoplay">
              <input type="checkbox" checked={autoSpeak} onChange={event => setAutoSpeak(event.target.checked)} />
              <i aria-hidden="true" /><span>自动播放</span>
            </label>
          )}
        </div>
        <div><span>{isReview ? '错题巩固' : modeNames[activeMode]}</span><strong>{questions.length ? `${Math.min(index + 1, questions.length)} / ${questions.length}` : '0 / 0'}</strong></div>
      </header>

      {!isReview && (
        <section className="practice-setup" aria-label="练习设置">
          <details className="course-picker">
            <summary><span>练习范围</span><strong>{selectedLabel}</strong><ChevronDown size={18} /></summary>
            <div className="course-options">
              <label className="select-all"><input type="checkbox" checked={allSelected} onChange={toggleAllLessons} /><span>初级全部课程</span><small>{vocabulary.length} 词 · {sentences.length} 句</small></label>
              {lessons.map(lesson => (
                <label key={lesson.id}><input type="checkbox" checked={selectedLessons.has(lesson.id)} onChange={() => toggleLesson(lesson.id)} /><span>第 {lesson.order} 课 · {lesson.title}</span><small>{lesson.vocabularyIds.length} 词 · {lesson.sentenceIds.length} 句</small></label>
              ))}
            </div>
          </details>
        </section>
      )}

      {completed ? (
        <section className="practice-complete">
          <p className="eyebrow">SESSION COMPLETE</p>
          <h1>お疲れ様でした！！</h1>
          <div className="star-rating" aria-label={`本轮评分 ${Math.round((summary.correct / Math.max(questions.length, 1)) * 5)} 星`}>
            {Array.from({ length: 5 }, (_, starIndex) => (
              <Star key={starIndex} size={28} fill={starIndex < Math.round((summary.correct / Math.max(questions.length, 1)) * 5) ? 'currentColor' : 'none'} />
            ))}
          </div>
          <div className="summary-grid">
            <div><span>答对</span><strong>{summary.correct}</strong></div>
            <div><span>答错</span><strong>{summary.incorrect}</strong></div>
            <div><span>跳过</span><strong>{summary.skipped}</strong></div>
            <div><span>正确率</span><strong>{Math.round((summary.correct / Math.max(questions.length, 1)) * 100)}%</strong></div>
          </div>
          <p>{summary.correct === questions.length ? '这一轮完成得很稳，继续保持。' : '可以回到首页换一个范围，或者进入错题本加强。'}</p>
          <div className="complete-actions">
            <Link to="/"><Home size={18} />返回首页</Link>
            <Link to="/review">查看错题本</Link>
          </div>
        </section>
      ) : !current ? (
        <section className="practice-empty">
          <h1>{isReview ? '错题已经全部巩固' : '当前范围没有可练习内容'}</h1>
          <p>{isReview ? '答对的内容已从错题本自动消除。' : '请至少选择一个包含当前题型的课程。'}</p>
          {isReview && <Link to="/review">返回错题本</Link>}
        </section>
      ) : (
        <section className="practice-stage" ref={stageRef}>
          <div className="practice-progress"><span>{selectedLabel}</span><button type="button" onClick={skipQuestion}>跳过本题 <SkipForward size={17} /></button></div>

          <div className={`question-prompt question-prompt--${activeMode}`}>
            <small>{activeMode === 'dictation' ? '听写词汇' : activeMode === 'translation' ? '根据中文写日文' : '补全短句'}</small>
            {activeMode === 'dictation' ? <button className="listen-command" type="button" onClick={speak}><Headphones size={24} />播放发音</button> : <h1>{current.prompt}</h1>}
            {activeMode !== 'dictation' && <button className="listen-link" type="button" onClick={speak}><Volume2 size={18} />播放发音</button>}
            <button className={`reference-peek ${showReference || result === 'correct' ? 'is-revealed' : ''}`} type="button" onClick={revealReference}>
              <span>参考答案</span><strong>{showReference || result === 'correct' ? `${current.answers.join(' / ')} · ${current.meaning}` : '＊＊＊＊＊＊'}</strong>
            </button>
          </div>

          <label className="answer-control">
            <span>输入日文答案</span>
            <input ref={inputRef} value={answer} readOnly={result === 'correct'} onFocus={handleInputFocus} onBlur={() => window.setTimeout(() => setKeyboardActive(false), 120)} onChange={event => { setAnswer(event.target.value); if (result === 'incorrect') setResult('idle'); }} onKeyDown={event => event.key === 'Enter' && checkAnswer()} placeholder="可输入汉字或假名" autoComplete="off" enterKeyHint="done" />
          </label>

          {result !== 'idle' && <div className={`answer-result ${result}`}><strong>{result === 'correct' ? '回答正确，正在进入下一题' : '答案不匹配，再试一次'}</strong><span>{result === 'correct' ? current.answers.join(' / ') : '可以播放发音或查看提示后继续作答'}</span></div>}

          <div className="practice-actions practice-actions--compact">
            <button type="button" className="secondary" onClick={() => { setAnswer(''); setResult('idle'); }}><RotateCcw size={18} />清空</button>
            <button type="button" className="primary" disabled={!answer.trim() || result === 'correct'} onClick={checkAnswer}><Check size={18} />提交答案</button>
          </div>
        </section>
      )}
    </main>
  );
}
