import type { Course, Lesson, Sentence, Vocabulary } from '../domain/models';
import lessonData from './generated/lessons.json';
import remainingSentenceData from './generated/sentences-11-50.json';
import vocabularyData from './generated/vocabulary.json';
import { generatedSentences } from './sentences';

export const vocabulary = vocabularyData as Vocabulary[];

export const sentences: Sentence[] = [
  ...generatedSentences,
  ...(remainingSentenceData as Sentence[])
];

const generatedLessons = lessonData as Lesson[];

export const lessons: Lesson[] = generatedLessons.map(lesson => ({
  ...lesson,
  sentenceIds: sentences.filter(sentence => sentence.lessonId === lesson.id).map(sentence => sentence.id)
}));

export const course: Course = {
  id: 'beginner-01',
  title: '初级日本语',
  description: '按 50 课课程顺序掌握词汇，并逐步补充经过审核的短句。',
  lessonIds: lessons.map(item => item.id)
};
