export type PracticeMode = 'dictation' | 'translation' | 'cloze';

export interface Vocabulary {
  id: string;
  courseId?: string;
  term: string;
  reading: string;
  accents: number[];
  partOfSpeech: string;
  meanings: string[];
  dictionaryForm?: string;
  sourceLesson: string;
  sourceLessonLabel?: string;
  sourceSequence?: number;
  sourceRow?: number;
  accentDisplay?: string;
  partOfSpeechCode?: string;
  romaji?: string;
}

export interface Sentence {
  id: string;
  courseId?: string;
  lessonId: string;
  text: string;
  reading: string;
  meaning: string;
  clozeText: string;
  answers: string[];
  vocabularyIds: string[];
  source: 'prototype' | 'generated' | 'verified';
}

export interface Lesson {
  id: string;
  courseId?: string;
  order: number;
  title: string;
  description: string;
  vocabularyIds: string[];
  sentenceIds: string[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  lessonIds: string[];
}

export interface LearningProgress {
  lessonId: string;
  vocabularyMastered: number;
  sentencesMastered: number;
  lastStudiedAt?: string;
}
