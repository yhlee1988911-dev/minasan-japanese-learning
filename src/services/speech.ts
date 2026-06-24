const audioUrls = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;

const speakWithDevice = (text: string) => new Promise<void>((resolve) => {
  if (!('speechSynthesis' in window)) {
    resolve();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.84;
  utterance.onend = () => resolve();
  utterance.onerror = () => resolve();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
});

const playAudio = (url: string) => new Promise<void>((resolve, reject) => {
  const audio = new Audio(url);
  activeAudio = audio;
  audio.onended = () => {
    if (activeAudio === audio) activeAudio = null;
    resolve();
  };
  audio.onerror = () => {
    if (activeAudio === audio) activeAudio = null;
    reject(new Error('Audio playback failed'));
  };
  audio.play().catch(reject);
});

const fetchGoogleSpeech = async (text: string) => {
  const cachedUrl = audioUrls.get(text);
  if (cachedUrl) return cachedUrl;

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error(`TTS request failed: ${response.status}`);

  const audio = await response.blob();
  if (!audio.size) throw new Error('TTS returned empty audio');
  const url = URL.createObjectURL(audio);
  audioUrls.set(text, url);
  return url;
};

export const stopJapaneseSpeech = () => {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  window.speechSynthesis?.cancel();
};

export const speakJapanese = async (text: string) => {
  const normalizedText = text.trim();
  if (!normalizedText) return;

  stopJapaneseSpeech();
  try {
    const audioUrl = await fetchGoogleSpeech(normalizedText);
    await playAudio(audioUrl);
  } catch {
    await speakWithDevice(normalizedText);
  }
};
