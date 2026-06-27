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

export const replaceMistakes = (records: MistakeRecord[]) => {
  writeMistakes(records);
};

export const mergeMistakeRecord = (record: MistakeRecord) => {
  const items = readMistakes();
  const existingIndex = items.findIndex(item => item.key === record.key);
  if (existingIndex >= 0) {
    items[existingIndex] = record;
  } else {
    items.push(record);
  }
  writeMistakes(items);
};

export const recordMistake = (question: Omit<MistakeRecord, 'key' | 'wrongCount' | 'lastWrongAt'>) => {
  const key = `${question.mode}:${question.id}`;
  const items = readMistakes();
  const existing = items.find(item => item.key === key);
  const lastWrongAt = new Date().toISOString();
  let record: MistakeRecord;
  if (existing) {
    existing.wrongCount += 1;
    existing.lastWrongAt = lastWrongAt;
    existing.prompt = question.prompt;
    existing.meaning = question.meaning;
    existing.speech = question.speech;
    existing.answers = question.answers;
    existing.lessonId = question.lessonId;
    record = existing;
  } else {
    record = { ...question, key, wrongCount: 1, lastWrongAt };
    items.push(record);
  }
  writeMistakes(items);
  return record;
};

export const removeMistake = (key: string) => {
  const items = readMistakes();
  const removed = items.find(item => item.key === key) || null;
  writeMistakes(items.filter(item => item.key !== key));
  return removed;
};
