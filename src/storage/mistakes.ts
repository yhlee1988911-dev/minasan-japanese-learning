import type { PracticeMode } from '../domain/models';

export interface MistakeRecord {
  key: string;
  id: string;
  mode: PracticeMode;
  lessonId: string;
  prompt: string;
  meaning: string;
  speech: string;
  answers: string[];
  wrongCount: number;
  lastWrongAt: string;
}

const STORAGE_KEY = 'minasan_mistakes_v1';

export const readMistakes = (): MistakeRecord[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as MistakeRecord[];
  } catch {
    return [];
  }
};

const writeMistakes = (items: MistakeRecord[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('minasan:mistakes-changed'));
};

export const recordMistake = (question: Omit<MistakeRecord, 'key' | 'wrongCount' | 'lastWrongAt'>) => {
  const key = `${question.mode}:${question.id}`;
  const items = readMistakes();
  const existing = items.find(item => item.key === key);
  if (existing) {
    existing.wrongCount += 1;
    existing.lastWrongAt = new Date().toISOString();
  } else {
    items.push({ ...question, key, wrongCount: 1, lastWrongAt: new Date().toISOString() });
  }
  writeMistakes(items);
};

export const removeMistake = (key: string) => {
  writeMistakes(readMistakes().filter(item => item.key !== key));
};
