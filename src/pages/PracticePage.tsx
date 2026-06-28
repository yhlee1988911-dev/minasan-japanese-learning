import { Check, ChevronDown, Headphones, Home, Play, RotateCcw, SkipForward, Star, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Course, Lesson, PracticeMode } from '../domain/models';
import type { CatalogPayload } from '../services/api';
import { loadCatalog, onVisible, sendLessonProgress, sendMistake, sendProgressAttempt, sendRemoveMistake } from '../services/api';
import { speakJapanese, stopJapaneseSpeech } from '../services/speech';
import { isMastered, mergeMasteryRecord, readMastery, recordMasteryAttempt } from '../storage/mastery';
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
  courseId: string;
  lessonId: string;
  prompt: string;
  meaning: string;
  speech: string;
  answers: string[];
}

const emptyCatalog: CatalogPayload = { courses: [], lessons: [], vocabulary: [], sentences: [] };

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const fromMistake = (item: MistakeRecord): PracticeQuestion => ({
  key: item.key,
  id: item.id,
  mode: item.mode,
  courseId: item.courseId || 'system-beginner-50',
  lessonId: item.lessonId,
  prompt: item.prompt,
  meaning: item.meaning,
  speech: item.speech,
  answers: item.answers
});

const getCourseCounts = (catalog: CatalogPayload, courseId: string) => ({
  lessons: catalog.lessons.filter(lesson => lesson.courseId === courseId).length,
  vocabulary: catalog.vocabulary.filter(word => word.courseId === courseId).length,
  sentences: catalog.sentences.filter(sentence => sentence.courseId === courseId).length
});

export function PracticePage() {
  const [params] = useSearchParams();
  const requestedMode = (params.get('mode') || 'translation') as PracticeMode;
  const requestedCourse = params.get('course') || '';
  const requestedLesson = params.get('lesson') || '';
  const isReview = params.get('review') === 'true';
  const [catalog, setCatalog] = useState<CatalogPayload>(emptyCatalog);
  const [selectedLessons, setSelectedLessons] = useState(() => new Set(requestedLesson ? [requestedLesson] : []));
  const [reviewItems, setReviewItems] = useState<MistakeRecord[]>(() => readMistakes());
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'idle' | 'correct' | 'incorrect'>('idle');
  const [summary, setSummary] = useState({ correct: 0, incorrect: 0, skipped: 0 });
  const [sessionState, setSessionState] = useState<'ready' | 'countdown' | 'active'>('ready');
  const [countdown, setCountdown] = useState(3);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const referenceTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const feedbackAudioRef = useRef<{ correct: HTMLAudioElement; incorrect: HTMLAudioElement } | null>(null);
  const completionAudioRef = useRef<{ success: HTMLAudioElement; fail: HTMLAudioElement } | null>(null);
  const completionPlayedRef = useRef(false);
  const questionStartedAtRef = useRef(Date.now());
  const questionOutcomesRef = useRef<Record<string, 'correct' | 'incorrect' | 'skipped'>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const refresh = () => {
      loadCatalog().then(data => {
        setCatalog(data);
        setSelectedLessons(previous => {
          if (previous.size) return previous;
          const courseLessons = requestedCourse
            ? data.lessons.filter(lesson => lesson.courseId === requestedCourse)
            : data.lessons;
          return new Set(courseLessons[0] ? [courseLessons[0].id] : []);
        });
      });
    };
    refresh();
    return onVisible(refresh);
  }, [requestedCourse]);

  const lessonById = useMemo(() => new Map(catalog.lessons.map(lesson => [lesson.id, lesson])), [catalog.lessons]);
  const courses = catalog.courses;

  const regularQuestions = useMemo<PracticeQuestion[]>(() => {
    if (requestedMode === 'cloze') {
      return catalog.sentences
        .filter(item => selectedLessons.has(item.lessonId))
        .map(item => ({
          key: `${item.courseId}:${requestedMode}:${item.id}`,
          id: item.id,
          mode: requestedMode,
          courseId: item.courseId || lessonById.get(item.lessonId)?.courseId || 'system-beginner-50',
          lessonId: item.lessonId,
          prompt: item.clozeText,
          meaning: item.meaning,
          speech: item.reading,
          answers: item.answers
        }));
    }

    return catalog.vocabulary
      .filter(item => selectedLessons.has(item.sourceLesson))
      .map(item => ({
        key: `${item.courseId}:${requestedMode}:${item.id}`,
        id: item.id,
        mode: requestedMode,
        courseId: item.courseId || lessonById.get(item.sourceLesson)?.courseId || 'system-beginner-50',
        lessonId: item.sourceLesson,
        prompt: item.meanings[0],
        meaning: item.meanings.join('；'),
        speech: item.reading,
        answers: [item.term, item.reading]
      }));
  }, [catalog.sentences, catalog.vocabulary, lessonById, requestedMode, selectedLessons]);

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
    questionOutcomesRef.current = {};
    completionPlayedRef.current = false;
    setCountdown(3);
    setSessionState(isReview ? 'active' : 'ready');
  }, [sourceQuestions, isReview]);

  useEffect(() => {
    if (sessionState !== 'countdown') return;
    if (countdown <= 0) {
      setSessionState('active');
      return;
    }
    const timer = window.setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, sessionState]);

  const sessionActive = sessionState === 'active';
  const completed = sessionActive && questions.length > 0 && index >= questions.length;
  const current = sessionActive && !completed && questions.length ? questions[index] : null;
  const activeMode = current?.mode || requestedMode;
  const selectedLabel = isReview
    ? '错题巩固'
    : selectedLessons.size === 1
        ? catalog.lessons.find(item => selectedLessons.has(item.id))?.title || '第 1 课'
        : `${selectedLessons.size} 个课时`;
  const completionTotal = Math.max(summary.correct + summary.incorrect + summary.skipped, questions.length ? 1 : 0, 1);
  const completionAccuracy = summary.correct / completionTotal;
  const completionStars = Math.round(completionAccuracy * 5);
  const completionPassed = completionStars >= 4;

  const startSession = () => {
    if (!sourceQuestions.length) return;
    stopJapaneseSpeech();
    setQuestions(shuffle(sourceQuestions));
    setIndex(0);
    setAnswer('');
    setResult('idle');
    setShowReference(false);
    setSummary({ correct: 0, incorrect: 0, skipped: 0 });
    questionOutcomesRef.current = {};
    completionPlayedRef.current = false;
    setCountdown(3);
    setSessionState('countdown');
  };

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

  const syncLessonProgress = useCallback((lessonId: string) => {
    const lesson = lessonById.get(lessonId);
    if (!lesson) return;
    const records = readMastery();
    const masteredVocabularyIds = new Set(records.filter(record => record.kind === 'vocabulary' && record.lessonId === lessonId && isMastered(record)).map(record => record.id));
    const masteredSentenceIds = new Set(records.filter(record => record.kind === 'sentence' && record.lessonId === lessonId && isMastered(record)).map(record => record.id));
    const total = lesson.vocabularyIds.length + lesson.sentenceIds.length;
    void sendLessonProgress({
      lessonId,
      courseId: lesson.courseId,
      vocabularyMasteredCount: lesson.vocabularyIds.filter(id => masteredVocabularyIds.has(id)).length,
      sentenceMasteredCount: lesson.sentenceIds.filter(id => masteredSentenceIds.has(id)).length,
      completed: total > 0
        && lesson.vocabularyIds.every(id => masteredVocabularyIds.has(id))
        && lesson.sentenceIds.every(id => masteredSentenceIds.has(id))
    }).catch(() => undefined);
  }, [lessonById]);

  const submitProgress = useCallback((question: PracticeQuestion, correct: boolean, mastered: boolean) => {
    if (isReview) return;
    const kind = question.id.startsWith('system-s-') || question.id.startsWith('s-') ? 'sentence' : 'vocabulary';
    recordMasteryAttempt({
      id: question.id,
      lessonId: question.lessonId,
      courseId: question.courseId,
      kind
    }, correct, mastered);
    void sendProgressAttempt({
      id: question.id,
      lessonId: question.lessonId,
      courseId: question.courseId,
      kind,
      correct,
      mastered
    }).then(response => {
      mergeMasteryRecord(response.record);
      syncLessonProgress(question.lessonId);
    }).catch(() => undefined);
  }, [isReview, syncLessonProgress]);

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

  const playCompletionFeedback = (passed: boolean) => {
    if (!completionAudioRef.current) {
      completionAudioRef.current = {
        success: new Audio('/sounds/chenggong.mp3'),
        fail: new Audio('/sounds/shibai.mp3')
      };
    }
    const sounds = completionAudioRef.current;
    sounds.success.pause();
    sounds.fail.pause();
    const audio = passed ? sounds.success : sounds.fail;
    audio.currentTime = 0;
    audio.volume = 0.82;
    void audio.play().catch(() => playSyntheticFeedback(passed));
  };

  useEffect(() => {
    if (!completed || completionPlayedRef.current) return;
    completionPlayedRef.current = true;
    playCompletionFeedback(completionPassed);
  }, [completed, completionPassed]);

  useEffect(() => {
    if (!completed || isReview) return;
    selectedLessons.forEach(lessonId => syncLessonProgress(lessonId));
  }, [completed, isReview, selectedLessons, syncLessonProgress]);

  useEffect(() => {
    if (!['dictation', 'cloze'].includes(activeMode) || !autoSpeak || !current) return;
    const timer = window.setTimeout(speak, 260);
    return () => window.clearTimeout(timer);
  }, [activeMode, autoSpeak, current, speak]);

  useEffect(() => {
    if (!current) return;
    questionStartedAtRef.current = Date.now();
  }, [current?.key]);

  useEffect(() => {
    if (result !== 'correct' || !current) return;
    const timer = window.setTimeout(() => {
      if (isReview) {
        removeMistake(current.key);
        void sendRemoveMistake(current.key).catch(() => undefined);
        setReviewItems(items => items.filter(item => item.key !== current.key));
      } else {
        setIndex(value => value + 1);
        resetQuestion();
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [current, isReview, resetQuestion, result]);

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
    completionAudioRef.current?.success.pause();
    completionAudioRef.current?.fail.pause();
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

  const toggleLesson = (lessonId: string, course: Course) => {
    const courseLessons = catalog.lessons.filter(lesson => lesson.courseId === course.id);
    setSelectedLessons(previous => {
      const next = new Set(courseLessons.filter(lesson => previous.has(lesson.id)).map(lesson => lesson.id));
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  };

  const toggleCourse = (course: Course) => {
    const courseLessons = catalog.lessons.filter(lesson => lesson.courseId === course.id);
    const allSelected = courseLessons.length > 0 && courseLessons.every(lesson => selectedLessons.has(lesson.id));
    setSelectedLessons(allSelected ? new Set() : new Set(courseLessons.map(item => item.id)));
  };

  const checkAnswer = () => {
    if (!current || !answer.trim() || result === 'correct') return;
    const normalized = normalizeAnswer(answer);
    const correct = current.answers.some(item => normalizeAnswer(item) === normalized);
    const previousOutcome = questionOutcomesRef.current[current.key];
    const firstAttempt = !previousOutcome;
    const elapsedMs = Date.now() - questionStartedAtRef.current;
    const mastered = correct && firstAttempt && elapsedMs <= 6000;
    setResult(correct ? 'correct' : 'incorrect');
    if (firstAttempt) {
      questionOutcomesRef.current[current.key] = correct ? 'correct' : 'incorrect';
      setSummary(value => ({
        ...value,
        correct: value.correct + (correct ? 1 : 0),
        incorrect: value.incorrect + (correct ? 0 : 1)
      }));
    }
    playFeedback(correct);
    if (!isReview) {
      submitProgress(current, correct, mastered);
    }
    if (!correct) {
      const mistake = recordMistake({
        id: current.id,
        mode: current.mode,
        courseId: current.courseId,
        lessonId: current.lessonId,
        prompt: current.prompt,
        meaning: current.meaning,
        speech: current.speech,
        answers: current.answers
      });
      void sendMistake(mistake).catch(() => undefined);
    }
  };

  const skipQuestion = () => {
    if (current && !questionOutcomesRef.current[current.key]) {
      questionOutcomesRef.current[current.key] = 'skipped';
      setSummary(value => ({ ...value, skipped: value.skipped + 1 }));
    }
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

      {!isReview && sessionState === 'ready' && (
        <section className="practice-setup" aria-label="练习设置">
          <div className="course-picker-split">
            {courses.map(course => {
              const courseLessons = catalog.lessons.filter(lesson => lesson.courseId === course.id);
              const selectedCount = courseLessons.filter(lesson => selectedLessons.has(lesson.id)).length;
              const counts = getCourseCounts(catalog, course.id);
              return (
                <details className={`course-picker ${selectedCount ? 'is-active' : 'is-muted'}`} key={course.id} open={requestedCourse === course.id || courses.length === 1}>
                  <summary><span>{course.title}</span><strong>{selectedCount ? `${selectedCount} 课` : '未选择'}</strong><ChevronDown size={18} /></summary>
                  <div className="course-options">
                    <label className="select-all"><input type="checkbox" checked={courseLessons.length > 0 && selectedCount === courseLessons.length} onChange={() => toggleCourse(course)} /><span>{course.title} 全部课程</span><small>{counts.vocabulary} 词 · {counts.sentences} 句</small></label>
                    {courseLessons.map((lesson: Lesson) => (
                      <label key={lesson.id}><input type="checkbox" checked={selectedLessons.has(lesson.id)} onChange={() => toggleLesson(lesson.id, course)} /><span>第 {lesson.order} 课 · {lesson.title}</span><small>{lesson.vocabularyIds.length} 词 · {lesson.sentenceIds.length} 句</small></label>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="practice-start-panel">
            <div>
              <span>{selectedLabel}</span>
              <strong>{sourceQuestions.length ? `${sourceQuestions.length} 题待练习` : '当前范围没有题目'}</strong>
            </div>
            <button type="button" onClick={startSession} disabled={!sourceQuestions.length}>
              <Play size={18} />开始
            </button>
          </div>
        </section>
      )}

      {sessionState === 'countdown' ? (
        <section className="practice-countdown" aria-live="polite">
          <span>{selectedLabel}</span>
          <strong>{countdown || '开始'}</strong>
        </section>
      ) : completed ? (
        <section className="practice-complete">
          <p className="eyebrow">SESSION COMPLETE</p>
          <h1>{completionPassed ? 'お疲れ様でした！！' : '次こそ頑張ろう！！！'}</h1>
          <div className="star-rating" aria-label={`本轮评分 ${completionStars} 星`}>
            {Array.from({ length: 5 }, (_, starIndex) => (
              <Star key={starIndex} size={28} fill={starIndex < completionStars ? 'currentColor' : 'none'} />
            ))}
          </div>
          <div className="summary-grid">
            <div><span>答对</span><strong>{summary.correct}</strong></div>
            <div><span>答错</span><strong>{summary.incorrect}</strong></div>
            <div><span>跳过</span><strong>{summary.skipped}</strong></div>
            <div><span>正确率</span><strong>{Math.round(completionAccuracy * 100)}%</strong></div>
          </div>
          <p>{completionPassed ? '这一轮完成得很稳，继续保持。' : '这轮先把错题收住，下次就会轻松很多。'}</p>
          <div className="complete-actions">
            <Link to="/"><Home size={18} />返回首页</Link>
            <Link to="/review">查看错题本</Link>
          </div>
        </section>
      ) : !sessionActive ? (
        <section className="practice-empty practice-ready">
          <h1>选择课程后开始练习</h1>
          <p>按下开始后会倒计时 3、2、1，再进入答题。</p>
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
              <span>参考答案</span><strong>{showReference || result === 'correct' ? `${current.answers.join(' / ')} · ${current.meaning}` : '******'}</strong>
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
