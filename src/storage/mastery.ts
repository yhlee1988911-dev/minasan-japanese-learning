export type MasteryKind = 'vocabulary' | 'sentence';

export interface MasteryRecord {
  id: string;
  lessonId: string;
  kind: MasteryKind;
  correctCount: number;
  wrongCount: number;
  lastPracticedAt: string;
}

const STORAGE_KEY = 'minasan_mastery_v1';

export const readMastery = (): MasteryRecord[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as MasteryRecord[];
  } catch {
    return [];
  }
};

export const isMastered = (record?: MasteryRecord) => Boolean(
  record && record.correctCount >= 2 && record.wrongCount === 0
);

export const recordMasteryAttempt = (
  item: Pick<MasteryRecord, 'id' | 'lessonId' | 'kind'>,
  correct: boolean
) => {
  const records = readMastery();
  const existing = records.find(record => record.id === item.id && record.kind === item.kind);
  if (existing) {
    existing.correctCount += correct ? 1 : 0;
    existing.wrongCount += correct ? 0 : 1;
    existing.lastPracticedAt = new Date().toISOString();
  } else {
    records.push({
      ...item,
      correctCount: correct ? 1 : 0,
      wrongCount: correct ? 0 : 1,
      lastPracticedAt: new Date().toISOString()
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event('minasan:mastery-changed'));
};

export const removeMasteryRecord = (kind: MasteryKind, id: string) => {
  const records = readMastery().filter(record => !(record.kind === kind && record.id === id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event('minasan:mastery-changed'));
};
