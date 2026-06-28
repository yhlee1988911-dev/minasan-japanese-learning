import type { Course, Lesson, Sentence, Vocabulary } from './models';

interface CatalogLike {
  vocabulary: Vocabulary[];
  sentences: Sentence[];
}

export const SYSTEM_COURSE_ID = 'system-beginner-50';
export const SYSTEM_DISPLAY_TITLE = 'N5-N4 词汇';
export const SYSTEM_DISPLAY_LESSON_ID = 'system-n5-n4-display';

export const getCourseTitle = (course?: Pick<Course, 'id' | 'title' | 'isSystem'> | null) => (
  course?.isSystem || course?.id === SYSTEM_COURSE_ID ? SYSTEM_DISPLAY_TITLE : course?.title || ''
);

export const getSystemDisplayLesson = (catalog: CatalogLike, course: Course): Lesson => {
  const vocabularyIds = catalog.vocabulary
    .filter(word => word.courseId === course.id)
    .map(word => word.id);
  const sentenceIds = catalog.sentences
    .filter(sentence => sentence.courseId === course.id)
    .map(sentence => sentence.id);

  return {
    id: SYSTEM_DISPLAY_LESSON_ID,
    courseId: course.id,
    order: 1,
    title: SYSTEM_DISPLAY_TITLE,
    description: `本类别收录 ${vocabularyIds.length} 个基础词汇。`,
    vocabularyIds,
    sentenceIds
  };
};
