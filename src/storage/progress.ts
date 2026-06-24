import type { LearningProgress } from '../domain/models';

const STORAGE_KEY = 'minasan_progress_v1';

export const readProgress = (): LearningProgress[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as LearningProgress[];
  } catch {
    return [];
  }
};

export const saveProgress = (next: LearningProgress[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
};
