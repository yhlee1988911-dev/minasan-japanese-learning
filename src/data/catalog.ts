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
  title: 'N5-N4 词汇',
  description: '系统默认 N5-N4 基础词汇，后续可按 N3、N2、N1 继续扩展。',
  lessonIds: lessons.map(item => item.id)
};
