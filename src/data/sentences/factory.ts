import type { Sentence } from '../../domain/models';

export const makeSentence = (
  lesson: number,
  sequence: number,
  text: string,
  reading: string,
  meaning: string,
  clozeText: string,
  answers: string[],
  vocabularyIds: string[]
): Sentence => ({
  id: `s-${String(lesson).padStart(2, '0')}-${String(sequence).padStart(2, '0')}`,
  lessonId: `lesson-${String(lesson).padStart(2, '0')}`,
  text,
  reading,
  meaning,
  clozeText,
  answers,
  vocabularyIds,
  source: 'generated'
});
