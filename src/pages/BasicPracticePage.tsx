import { Check, Headphones, Home, Languages, Shuffle, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { speakJapanese, stopJapaneseSpeech } from '../services/speech';

type BasicMode = 'dictation' | 'sound-choice' | 'kana-match';

interface KanaItem {
  id: string;
  group: 'hiragana' | 'katakana' | 'yoon';
  hiragana: string;
  katakana: string;
  romaji: string;
}

const basicModes: Array<{ id: BasicMode; title: string; description: string; icon: typeof Headphones }> = [
  { id: 'dictation', title: '听写功能', description: '听发音，输入平假名或片假名。', icon: Headphones },
  { id: 'sound-choice', title: '听音选字', description: '听发音，从选项中选出假名。', icon: Volume2 },
  { id: 'kana-match', title: '平假名选片假名', description: '看到平假名，选择对应片假名。', icon: Languages }
];

const kanaItems: KanaItem[] = [
  ['あ', 'ア', 'a'], ['い', 'イ', 'i'], ['う', 'ウ', 'u'], ['え', 'エ', 'e'], ['お', 'オ', 'o'],
  ['か', 'カ', 'ka'], ['き', 'キ', 'ki'], ['く', 'ク', 'ku'], ['け', 'ケ', 'ke'], ['こ', 'コ', 'ko'],
  ['さ', 'サ', 'sa'], ['し', 'シ', 'shi'], ['す', 'ス', 'su'], ['せ', 'セ', 'se'], ['そ', 'ソ', 'so'],
  ['た', 'タ', 'ta'], ['ち', 'チ', 'chi'], ['つ', 'ツ', 'tsu'], ['て', 'テ', 'te'], ['と', 'ト', 'to'],
  ['な', 'ナ', 'na'], ['に', 'ニ', 'ni'], ['ぬ', 'ヌ', 'nu'], ['ね', 'ネ', 'ne'], ['の', 'ノ', 'no'],
  ['は', 'ハ', 'ha'], ['ひ', 'ヒ', 'hi'], ['ふ', 'フ', 'fu'], ['へ', 'ヘ', 'he'], ['ほ', 'ホ', 'ho'],
  ['ま', 'マ', 'ma'], ['み', 'ミ', 'mi'], ['む', 'ム', 'mu'], ['め', 'メ', 'me'], ['も', 'モ', 'mo'],
  ['や', 'ヤ', 'ya'], ['ゆ', 'ユ', 'yu'], ['よ', 'ヨ', 'yo'],
  ['ら', 'ラ', 'ra'], ['り', 'リ', 'ri'], ['る', 'ル', 'ru'], ['れ', 'レ', 're'], ['ろ', 'ロ', 'ro'],
  ['わ', 'ワ', 'wa'], ['を', 'ヲ', 'wo'], ['ん', 'ン', 'n']
].map(([hiragana, katakana, romaji]) => ({ id: `kana-${romaji}`, group: 'hiragana', hiragana, katakana, romaji }));

const yoonItems: KanaItem[] = [
  ['きゃ', 'キャ', 'kya'], ['きゅ', 'キュ', 'kyu'], ['きょ', 'キョ', 'kyo'],
  ['しゃ', 'シャ', 'sha'], ['しゅ', 'シュ', 'shu'], ['しょ', 'ショ', 'sho'],
  ['ちゃ', 'チャ', 'cha'], ['ちゅ', 'チュ', 'chu'], ['ちょ', 'チョ', 'cho'],
  ['にゃ', 'ニャ', 'nya'], ['にゅ', 'ニュ', 'nyu'], ['にょ', 'ニョ', 'nyo'],
  ['ひゃ', 'ヒャ', 'hya'], ['ひゅ', 'ヒュ', 'hyu'], ['ひょ', 'ヒョ', 'hyo'],
  ['みゃ', 'ミャ', 'mya'], ['みゅ', 'ミュ', 'myu'], ['みょ', 'ミョ', 'myo'],
  ['りゃ', 'リャ', 'rya'], ['りゅ', 'リュ', 'ryu'], ['りょ', 'リョ', 'ryo']
].map(([hiragana, katakana, romaji]) => ({ id: `yoon-${romaji}`, group: 'yoon', hiragana, katakana, romaji }));

const allItems = [...kanaItems, ...yoonItems];

const normalizeKana = (value: string) => value.normalize('NFC').trim();

const sample = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

export function BasicPracticePage() {
  const [mode, setMode] = useState<BasicMode>('dictation');
  const [group, setGroup] = useState<'all' | 'hiragana' | 'katakana' | 'yoon'>('all');
  const [current, setCurrent] = useState(() => sample(allItems));
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'idle' | 'correct' | 'incorrect'>('idle');
  const [stats, setStats] = useState({ correct: 0, incorrect: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackAudioRef = useRef<{ correct: HTMLAudioElement; incorrect: HTMLAudioElement } | null>(null);

  const pool = useMemo(() => {
    if (group === 'all') return allItems;
    if (group === 'yoon') return yoonItems;
    return kanaItems;
  }, [group]);

  const nextQuestion = useCallback(() => {
    setCurrent(previous => {
      const candidates = pool.length > 1 ? pool.filter(item => item.id !== previous.id) : pool;
      return sample(candidates);
    });
    setAnswer('');
    setResult('idle');
  }, [pool]);

  const speak = useCallback(async () => {
    await speakJapanese(current.hiragana);
  }, [current]);

  const choices = useMemo(() => {
    const value = mode === 'kana-match' ? current.katakana : current.hiragana;
    const rest = shuffle(pool.filter(item => item.id !== current.id)).slice(0, 5).map(item => mode === 'kana-match' ? item.katakana : item.hiragana);
    return shuffle([value, ...rest]);
  }, [current, mode, pool]);

  useEffect(() => {
    nextQuestion();
  }, [group, mode, nextQuestion]);

  useEffect(() => {
    const timer = window.setTimeout(speak, 260);
    return () => window.clearTimeout(timer);
  }, [current, mode, speak]);

  useEffect(() => () => {
    stopJapaneseSpeech();
    feedbackAudioRef.current?.correct.pause();
    feedbackAudioRef.current?.incorrect.pause();
  }, []);

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
    void audio.play().catch(() => undefined);
  };

  const record = (correct: boolean) => {
    setResult(correct ? 'correct' : 'incorrect');
    playFeedback(correct);
    setStats(value => ({
      correct: value.correct + (correct ? 1 : 0),
      incorrect: value.incorrect + (correct ? 0 : 1)
    }));
    if (correct) window.setTimeout(nextQuestion, 2000);
  };

  const submitInput = () => {
    if (!answer.trim()) return;
    record([current.hiragana, current.katakana].some(item => normalizeKana(item) === normalizeKana(answer)));
  };

  const choose = (choice: string) => {
    const correct = choice === (mode === 'kana-match' ? current.katakana : current.hiragana);
    record(correct);
  };

  return (
    <main className="practice-page basic-page">
      <header className="practice-header">
        <div className="practice-header__left"><Link to="/"><Home size={18} />返回首页</Link></div>
        <div><span>基础训练</span><strong>{stats.correct} / {stats.correct + stats.incorrect}</strong></div>
      </header>

      <section className="basic-mode-grid" aria-label="基础训练模式">
        {basicModes.map(({ id, title, description, icon: Icon }) => (
          <button type="button" className={mode === id ? 'active' : ''} key={id} onClick={() => setMode(id)}>
            <Icon size={20} /><strong>{title}</strong><span>{description}</span>
          </button>
        ))}
      </section>

      <section className="basic-filter" aria-label="假名范围">
        {[
          ['all', '全部'],
          ['hiragana', '平假名'],
          ['katakana', '片假名'],
          ['yoon', '拗音']
        ].map(([id, label]) => (
          <button type="button" className={group === id ? 'active' : ''} key={id} onClick={() => setGroup(id as typeof group)}>{label}</button>
        ))}
      </section>

      <section className={`practice-stage basic-stage question-prompt--${mode === 'kana-match' ? 'translation' : 'dictation'}`}>
        <div className="practice-progress">
          <span>{mode === 'dictation' ? '听写假名' : mode === 'sound-choice' ? '听音选字' : '平假名选片假名'}</span>
          <button type="button" onClick={nextQuestion}>换一题 <Shuffle size={17} /></button>
        </div>

        <div className="basic-card">
          <small>{current.romaji}</small>
          {mode === 'kana-match' ? (
            <>
              <h1>{current.hiragana}</h1>
              <button className="listen-link" type="button" onClick={speak}><Headphones size={18} />播放发音</button>
            </>
          ) : (
            <button className="listen-command" type="button" onClick={speak}><Headphones size={24} />播放发音</button>
          )}
          <p>{mode === 'kana-match' ? '请选择对应片假名' : '听到后输入或选择对应假名'}</p>
        </div>

        {mode === 'dictation' ? (
          <>
            <label className="answer-control">
              <span>输入假名</span>
              <input ref={inputRef} value={answer} onChange={event => { setAnswer(event.target.value); if (result === 'incorrect') setResult('idle'); }} onKeyDown={event => event.key === 'Enter' && submitInput()} placeholder="例：み / ミ" autoComplete="off" />
            </label>
            <div className="practice-actions practice-actions--compact">
              <button type="button" className="secondary" onClick={() => setAnswer('')}>清空</button>
              <button type="button" className="primary" disabled={!answer.trim()} onClick={submitInput}><Check size={18} />提交答案</button>
            </div>
          </>
        ) : (
          <div className="kana-choice-grid">
            {choices.map(choice => <button type="button" key={choice} onClick={() => choose(choice)}>{choice}</button>)}
          </div>
        )}

        {result !== 'idle' && <div className={`answer-result ${result}`}><strong>{result === 'correct' ? '回答正确' : '再试一次'}</strong><span>{current.hiragana} / {current.katakana}</span></div>}
      </section>
    </main>
  );
}
