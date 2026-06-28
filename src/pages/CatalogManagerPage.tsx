import { Download, FileSpreadsheet, Pencil, Plus, RefreshCw, Search, Share2, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { readSheet } from 'read-excel-file/browser';
import type { Course, Lesson, Vocabulary } from '../domain/models';
import type { AuthUser, CatalogImportPreview, CatalogPayload } from '../services/api';
import {
  commitCatalogImport,
  createCatalogCourse,
  createCatalogLesson,
  createCatalogWord,
  deleteCatalogCourse,
  deleteCatalogLesson,
  deleteCatalogWord,
  loadCatalog,
  previewCatalogImport,
  shareCatalogCourse,
  updateCatalogCourse,
  updateCatalogLesson,
  updateCatalogWord
} from '../services/api';

const emptyCatalog: CatalogPayload = { courses: [], lessons: [], vocabulary: [], sentences: [] };
const emptyWord = { term: '', reading: '', meaning: '', romaji: '', partOfSpeech: '', tags: '' };
const templateUrl = '/api/catalog/template.xlsx';
const maxImportFileSize = 2 * 1024 * 1024;
const maxImportTextLength = 500_000;
const maxImportRows = 5000;
const supportedImportFilePattern = /\.(xlsx|csv|tsv|txt)$/i;
const isExcelFile = (file: File) => /\.xlsx$/i.test(file.name);
const isSupportedImportFile = (file: File) => supportedImportFilePattern.test(file.name);
const cellToImportText = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
};
const splitImportLine = (line: string) => line.includes('\t') ? line.split('\t') : line.split(',');
const hasCompactHeader = (cells: string[]) => cells.some(cell => /日文|日语|日語|假名|罗马|羅馬|释义|釋義|中文|meaning/i.test(cell));
const normalizeCompactImportText = (text: string, lesson?: Lesson | null) => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return text;
  const rows = lines.map(line => splitImportLine(line).map(cell => cell.trim()));
  const dataRows = hasCompactHeader(rows[0]) ? rows.slice(1) : rows;
  const compact = dataRows.length > 0 && dataRows.every(row => row.length === 4 && row.every(Boolean));
  if (!compact) return text;
  const lessonOrder = lesson?.order || 1;
  const lessonTitle = lesson?.title || `第${lessonOrder}课`;
  const header = ['课时序号', '课时名称', '日文', '假名', '罗马音', '释义', '词性', '标签'];
  const withLesson = dataRows.map(row => [
    String(lessonOrder),
    lessonTitle,
    row[0],
    row[1],
    row[2],
    row[3],
    '',
    ''
  ].map(cellToImportText).join('\t'));
  return [header.join('\t'), ...withLesson].join('\n');
};
const normalizeImportRows = (rows: unknown[][]) => {
  const nonEmptyRows = rows.filter(row => row.some(cell => String(cell ?? '').trim()));
  if (nonEmptyRows.length > maxImportRows) throw new Error(`一次最多导入 ${maxImportRows} 行，请分批上传`);
  const compactRows = nonEmptyRows.map(row => row.slice(0, 4).map(cellToImportText));
  const canUseFirstFourColumns = compactRows.length > 0 && compactRows.every(row => row.length === 4 && row.every(Boolean));
  const sourceRows = canUseFirstFourColumns ? compactRows : nonEmptyRows.map(row => row.map(cellToImportText));
  return sourceRows
    .map(row => row.join('\t'))
    .join('\n');
};

const validateImportText = (text: string) => {
  if (text.length > maxImportTextLength) return '导入内容过大，请分批上传';
  const rowCount = text.split(/\r?\n/).filter(line => line.trim()).length;
  if (rowCount > maxImportRows) return `一次最多导入 ${maxImportRows} 行，请分批上传`;
  return '';
};

const readImportFile = async (file: File) => {
  if (!isSupportedImportFile(file)) throw new Error('仅支持 XLSX、CSV、TSV、TXT 文件');
  if (file.size > maxImportFileSize) throw new Error('文件不能超过 2MB，请分批导入');
  const text = isExcelFile(file)
    ? normalizeImportRows(await readSheet(file) as unknown[][])
    : await file.text();
  const validationError = validateImportText(text);
  if (validationError) throw new Error(validationError);
  return text;
};

export function CatalogManagerPage({ user }: { user?: AuthUser | null }) {
  const [catalog, setCatalog] = useState<CatalogPayload>(emptyCatalog);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [courseScope, setCourseScope] = useState<'user' | 'system'>(user?.username === 'root' ? 'system' : 'user');
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ order: 1, title: '' });
  const [wordForm, setWordForm] = useState(emptyWord);
  const [editingWordId, setEditingWordId] = useState('');
  const [editingCourse, setEditingCourse] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState('');
  const [lessonTitleDraft, setLessonTitleDraft] = useState('');
  const [search, setSearch] = useState('');
  const [shareTargets, setShareTargets] = useState('');
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<CatalogImportPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = async () => {
    const data = await loadCatalog();
    setCatalog(data);
    setSelectedCourseId(current => current || data.courses.find(course => user?.username === 'root' ? course.isSystem : !course.isSystem)?.id || data.courses.find(course => !course.isSystem)?.id || '');
  };

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : '词库读取失败'));
  }, []);

  const isRoot = user?.username === 'root';
  const systemCourses = useMemo(() => catalog.courses.filter(course => course.isSystem), [catalog.courses]);
  const userCourses = useMemo(() => catalog.courses.filter(course => !course.isSystem), [catalog.courses]);
  const editableCourses = useMemo(() => courseScope === 'system' && isRoot ? systemCourses : userCourses, [courseScope, isRoot, systemCourses, userCourses]);
  const selectedCourse = useMemo(() => editableCourses.find(course => course.id === selectedCourseId) || editableCourses[0], [editableCourses, selectedCourseId]);
  const isSystemCourse = Boolean(selectedCourse?.isSystem);
  const vocabularyLimit = isSystemCourse ? 20000 : 500;
  const lessons = useMemo(() => selectedCourse ? catalog.lessons.filter(lesson => lesson.courseId === selectedCourse.id) : [], [catalog.lessons, selectedCourse]);
  const selectedLesson = useMemo(() => lessons.find(lesson => lesson.id === selectedLessonId) || lessons[0], [lessons, selectedLessonId]);
  const words = useMemo(() => {
    const source = selectedLesson ? catalog.vocabulary.filter(word => word.sourceLesson === selectedLesson.id) : [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return source;
    return source.filter(word => [
      word.term,
      word.reading,
      word.romaji,
      word.meanings.join('；'),
      word.partOfSpeech
    ].some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [catalog.vocabulary, search, selectedLesson]);

  useEffect(() => {
    if (selectedCourse && selectedCourse.id !== selectedCourseId) setSelectedCourseId(selectedCourse.id);
    if (lessons.length && !lessons.some(lesson => lesson.id === selectedLessonId)) setSelectedLessonId(lessons[0].id);
    const usedOrders = new Set(lessons.map(lesson => lesson.order));
    if (usedOrders.has(lessonForm.order)) {
      const nextOrder = Array.from({ length: 200 }, (_, index) => index + 1).find(order => !usedOrders.has(order)) || 200;
      setLessonForm(value => ({ ...value, order: nextOrder }));
    }
  }, [lessons, selectedCourse, selectedCourseId, selectedLessonId]);

  useEffect(() => {
    if (courseScope === 'system' && !isRoot) setCourseScope('user');
  }, [courseScope, isRoot]);

  const switchScope = (scope: 'user' | 'system') => {
    setCourseScope(scope);
    setEditingCourse(false);
    setCourseForm({ title: '', description: '' });
    setEditingWordId('');
    setWordForm(emptyWord);
    setSearch('');
    setImportText('');
    setShareTargets('');
    setPreview(null);
    const nextCourse = scope === 'system' ? systemCourses[0] : userCourses[0];
    setSelectedCourseId(nextCourse?.id || '');
    setSelectedLessonId('');
  };

  const run = async (task: () => Promise<CatalogPayload | unknown>, success: string) => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const result = await task();
      if (result && typeof result === 'object' && 'courses' in result) {
        setCatalog(result as CatalogPayload);
      } else {
        await refresh();
      }
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setWorking(false);
    }
  };

  const submitCourse = (event: FormEvent) => {
    event.preventDefault();
    if (editingCourse && selectedCourse) {
      void run(() => updateCatalogCourse(selectedCourse.id, courseForm.title, courseForm.description), '课件已更新').then(() => setEditingCourse(false));
    } else {
      void run(() => createCatalogCourse(courseForm.title, courseForm.description, courseScope), courseScope === 'system' ? '公共课件已创建' : '课件已创建').then(() => setCourseForm({ title: '', description: '' }));
    }
  };

  const startEditCourse = (course: Course) => {
    setEditingCourse(true);
    setSelectedCourseId(course.id);
    setCourseForm({ title: course.title, description: course.description });
  };

  const submitLesson = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCourse) return;
    const targetCourseId = selectedCourse.id;
    const targetOrder = lessonForm.order;
    void run(async () => {
      const result = await createCatalogLesson(targetCourseId, targetOrder, lessonForm.title || `第${targetOrder}课`);
      const createdLesson = result.lessons.find(lesson => lesson.courseId === targetCourseId && lesson.order === targetOrder);
      if (createdLesson) setSelectedLessonId(createdLesson.id);
      return result;
    }, '课时已添加').then(() => setLessonForm({ order: Math.min(targetOrder + 1, 200), title: '' }));
  };

  const saveLessonTitle = (lesson: Lesson) => {
    void run(() => updateCatalogLesson(lesson.id, lessonTitleDraft || lesson.title, lesson.description), '课时名称已修改')
      .then(() => {
        setEditingLessonId('');
        setLessonTitleDraft('');
      });
  };

  const startEditWord = (word: Vocabulary) => {
    setEditingWordId(word.id);
    setWordForm({
      term: word.term,
      reading: word.reading,
      meaning: word.meanings.join('；'),
      romaji: word.romaji || '',
      partOfSpeech: word.partOfSpeech || '',
      tags: ''
    });
  };

  const submitWord = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedLesson) return;
    const payload = { lessonId: selectedLesson.id, ...wordForm };
    if (editingWordId) {
      void run(() => updateCatalogWord({ wordId: editingWordId, ...payload }), '词条已保存').then(() => {
        setEditingWordId('');
        setWordForm(emptyWord);
      });
    } else {
      void run(() => createCatalogWord(payload), '词条已添加').then(() => setWordForm(emptyWord));
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    setError('');
    try {
      setImportText(await readImportFile(file));
      setPreview(null);
      setMessage(isExcelFile(file) ? 'Excel 文件已读取，请先解析预览' : '文件已读取，请先解析预览');
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件读取失败');
    } finally {
      setWorking(false);
      event.target.value = '';
    }
  };

  const previewImport = () => {
    if (!selectedCourse) return;
    setWorking(true);
    setError('');
    const payloadText = normalizeCompactImportText(importText, selectedLesson);
    const validationError = validateImportText(payloadText);
    if (validationError) {
      setError(validationError);
      setWorking(false);
      return;
    }
    previewCatalogImport(selectedCourse.id, payloadText, selectedLesson?.id || '')
      .then(setPreview)
      .catch(err => setError(err instanceof Error ? err.message : '导入预览失败'))
      .finally(() => setWorking(false));
  };

  const commitImport = () => {
    if (!selectedCourse) return;
    const payloadText = normalizeCompactImportText(importText, selectedLesson);
    const validationError = validateImportText(payloadText);
    if (validationError) {
      setError(validationError);
      return;
    }
    const targetLessonTitle = selectedLesson ? `第${selectedLesson.order}课 ${selectedLesson.title}` : '第1课';
    const createCount = preview?.summary.create || 0;
    const updateCount = preview?.summary.update || 0;
    const sameCount = preview?.summary.same || 0;
    const totalCount = preview?.summary.total || 0;
    const ok = window.confirm([
      '确认写入词库？',
      `课件：${selectedCourse.title}`,
      `课时：${targetLessonTitle}`,
      `本次解析：${totalCount} 条`,
      `新增：${createCount} 条，更新：${updateCount} 条，不变：${sameCount} 条`
    ].join('\n'));
    if (!ok) return;
    void run(() => commitCatalogImport(selectedCourse.id, payloadText, selectedLesson?.id || ''), '导入已写入').then(() => {
      setPreview(null);
      setImportText('');
    });
  };

  const clearImport = () => {
    setImportText('');
    setPreview(null);
    setMessage('');
    setError('');
  };

  const confirmDeleteCourse = (course: Course) => {
    if (course.isSystem) {
      setError('公共词库不能整套删除，请删除或更新具体课时和词条');
      return;
    }
    const ok = window.confirm([
      '确认删除课件？',
      `课件：${course.title}`,
      '该课件下的课时、词条和学习记录会被清除。',
      '此操作无法撤销。'
    ].join('\n'));
    if (!ok) return;
    void run(() => deleteCatalogCourse(course.id), '课件已删除');
  };

  const shareSelectedCourse = () => {
    if (!selectedCourse || !isRoot) return;
    if (selectedCourse.isSystem) {
      setError('公共词库不需要分享课件，请切换到“我的词库”后分享自定义课件');
      return;
    }
    const targets = shareTargets.trim();
    if (!targets) {
      setError('请输入目标用户 ID');
      return;
    }
    const lessonCount = catalog.lessons.filter(lesson => lesson.courseId === selectedCourse.id).length;
    const wordCount = catalog.vocabulary.filter(word => word.courseId === selectedCourse.id).length;
    const ok = window.confirm([
      '确认分享课件？',
      `课件：${selectedCourse.title}`,
      `内容：${lessonCount} 个课时，${wordCount} 个词条`,
      `目标用户：${targets}`,
      '系统会复制成目标用户的自定义课件，不复制学习进度。'
    ].join('\n'));
    if (!ok) return;
    void run(async () => {
      const result = await shareCatalogCourse(selectedCourse.id, targets);
      setShareTargets('');
      return result.catalog;
    }, '课件已分享');
  };

  const confirmDeleteLesson = (lesson: Lesson) => {
    const wordCount = catalog.vocabulary.filter(word => word.sourceLesson === lesson.id).length;
    const ok = window.confirm([
      '确认删除课时？',
      `课时：第${lesson.order}课 ${lesson.title}`,
      `该课时下 ${wordCount} 个词条会被删除。`,
      '此操作无法撤销。'
    ].join('\n'));
    if (!ok) return;
    void run(() => deleteCatalogLesson(lesson.id), '课时已删除');
  };

  const confirmDeleteWord = (word: Vocabulary) => {
    const ok = window.confirm([
      '确认删除词条？',
      `词条：${word.term}`,
      `假名：${word.reading}`,
      '此操作无法撤销。'
    ].join('\n'));
    if (!ok) return;
    void run(() => deleteCatalogWord(word.id), '词条已删除');
  };

  const selectedCourseWordCount = selectedCourse
    ? catalog.vocabulary.filter(word => word.courseId === selectedCourse.id).length
    : 0;

  return (
    <main className="content-section page-section catalog-manager">
      <div className="page-heading">
        <p className="eyebrow">MY VOCABULARY</p>
        <h1>{isRoot ? '词库管理' : '自定义词库'}</h1>
        <p>{isRoot ? '管理员可以维护公共 N5-N4 等开源词库，也可以管理自己的自定义词库。普通用户默认使用公共基础词库，并独立维护个人词库。' : '每个账户最多 10 个课件、每课件最多 200 课时和 500 个词条。公共基础词库由管理员维护。'}</p>
      </div>

      {(message || error) && <p className={error ? 'admin-error' : 'admin-success'}>{error || message}</p>}

      <section className="catalog-steps">
        <section className="catalog-step">
          <div className="catalog-step__heading">
            <span>步骤 1</span>
            <div><h2>添加或选择课件</h2><p>{isSystemCourse ? '当前正在维护公共基础词库，修改后会作为所有用户的默认开源词库内容。' : '一个课件是一套独立词库，例如自建考试词表或某个来源的课程。'}</p></div>
            <strong>{courseScope === 'system' ? `${systemCourses.length} 公共` : `${userCourses.length} / 10`}</strong>
          </div>
          <div className="catalog-step__body catalog-step__body--course">
            <div>
              {isRoot && (
                <div className="catalog-scope-tabs" aria-label="词库范围">
                  <button type="button" className={courseScope === 'system' ? 'active' : ''} onClick={() => switchScope('system')}>公共词库</button>
                  <button type="button" className={courseScope === 'user' ? 'active' : ''} onClick={() => switchScope('user')}>我的词库</button>
                </div>
              )}
              <div className="catalog-course-list">
                {editableCourses.map(course => (
                  <button type="button" className={selectedCourse?.id === course.id ? 'active' : ''} key={course.id} onClick={() => setSelectedCourseId(course.id)}>
                    <strong>{course.title}</strong>
                    <span>{course.isSystem ? '公共开源词库 · ' : ''}{catalog.lessons.filter(lesson => lesson.courseId === course.id).length} 课 · {catalog.vocabulary.filter(word => word.courseId === course.id).length} 词</span>
                  </button>
                ))}
                {!editableCourses.length && <p className="catalog-muted">{courseScope === 'system' ? '暂无公共词库，可新增 N3、N2、N1 等公共课件。' : '暂无自定义课件，请先新增。'}</p>}
              </div>
            </div>

            <form className="catalog-form" onSubmit={submitCourse}>
              <label><span>{editingCourse ? '修改课件名称' : courseScope === 'system' ? '新增公共课件名称' : '新增课件名称'}</span><input value={courseForm.title} onChange={event => setCourseForm(value => ({ ...value, title: event.target.value }))} placeholder={courseScope === 'system' ? '例：N3 词汇' : '例：自定义日语词库'} /></label>
              <label><span>说明</span><input value={courseForm.description} onChange={event => setCourseForm(value => ({ ...value, description: event.target.value }))} placeholder="可选" /></label>
              <div className="catalog-actions">
                <button type="submit" disabled={working || !courseForm.title.trim()}><Plus size={16} />{editingCourse ? '保存课件' : courseScope === 'system' ? '新增公共课件' : '新增课件'}</button>
                {selectedCourse && <button type="button" className="muted" onClick={() => startEditCourse(selectedCourse)}><Pencil size={16} />编辑选中</button>}
                {selectedCourse && !selectedCourse.isSystem && <button type="button" className="danger" onClick={() => confirmDeleteCourse(selectedCourse)}><Trash2 size={16} />删除课件</button>}
              </div>
              {isRoot && selectedCourse && !selectedCourse.isSystem && (
                <div className="catalog-share">
                  <label><span>分享给用户 ID</span><input value={shareTargets} onChange={event => setShareTargets(event.target.value)} placeholder="可输入 username 或 user-id，多个用；分隔" /></label>
                  <button type="button" onClick={shareSelectedCourse} disabled={working || !shareTargets.trim()}><Share2 size={16} />分享课件</button>
                </div>
              )}
            </form>
          </div>
        </section>

        <section className={`catalog-step ${!selectedCourse ? 'is-disabled' : ''}`}>
          <div className="catalog-step__heading">
            <span>步骤 2</span>
            <div><h2>添加或选择课时</h2><p>{selectedCourse ? `${selectedCourse.title} 当前有 ${lessons.length} 个课时。` : '请先在步骤 1 中选择或创建课件。'}</p></div>
            <strong>{selectedCourse ? `${lessons.length} / 200` : '-'}</strong>
          </div>
          {selectedCourse ? (
            <div className="catalog-step__body">
              <form className="catalog-form catalog-form--inline" onSubmit={submitLesson}>
                <label><span>课时</span><select value={lessonForm.order} onChange={event => setLessonForm(value => ({ ...value, order: Number(event.target.value) }))}>{Array.from({ length: 200 }, (_, index) => {
                  const order = index + 1;
                  const exists = lessons.some(lesson => lesson.order === order);
                  return <option key={order} value={order} disabled={exists}>第{order}课{exists ? '（已存在）' : ''}</option>;
                })}</select></label>
                <label><span>课时名称</span><input value={lessonForm.title} onChange={event => setLessonForm(value => ({ ...value, title: event.target.value }))} placeholder={`第${lessonForm.order}课`} /></label>
                <button type="submit" disabled={working}><Plus size={16} />添加课时</button>
              </form>

              <div className="catalog-lesson-strip">
                {lessons.map(lesson => (
                  <article className={selectedLesson?.id === lesson.id ? 'active' : ''} key={lesson.id}>
                    <button type="button" onClick={() => setSelectedLessonId(lesson.id)}>
                      <strong>第{lesson.order}课</strong>
                      <span>{lesson.title}</span>
                    </button>
                    {editingLessonId === lesson.id ? (
                      <div className="catalog-lesson-edit">
                        <input value={lessonTitleDraft} onChange={event => setLessonTitleDraft(event.target.value)} />
                        <button type="button" onClick={() => saveLessonTitle(lesson)}>保存</button>
                        <button type="button" className="muted" onClick={() => { setEditingLessonId(''); setLessonTitleDraft(''); }}>取消</button>
                      </div>
                    ) : (
                      <div className="catalog-lesson-actions">
                        <button type="button" title="修改课时名称" onClick={() => { setEditingLessonId(lesson.id); setLessonTitleDraft(lesson.title); }}><Pencil size={15} /></button>
                        <button type="button" title="删除课时" onClick={() => confirmDeleteLesson(lesson)}><Trash2 size={15} /></button>
                      </div>
                    )}
                  </article>
                ))}
                {!lessons.length && <p className="catalog-muted">暂无课时，可手动添加，也可在步骤 3 批量导入时自动创建。</p>}
              </div>
            </div>
          ) : <section className="mastery-empty"><FileSpreadsheet size={34} /><p>请先完成步骤 1。</p></section>}
        </section>

        <section className={`catalog-step ${!selectedCourse ? 'is-disabled' : ''}`}>
          <div className="catalog-step__heading">
            <span>步骤 3</span>
            <div><h2>添加词库或修改词条</h2><p>{selectedCourse ? `${selectedCourse.title} 当前共 ${selectedCourseWordCount} 个词条。` : '选择课件后可上传 Excel、批量预览，或手动编辑词条。'}</p></div>
            <strong>{selectedCourse ? `${selectedCourseWordCount} / ${vocabularyLimit}` : '-'}</strong>
          </div>
          {selectedCourse ? (
            <div className="catalog-step__body">
              <section className="catalog-import">
                <div className="section-title"><h2>批量导入词库</h2><a href={templateUrl} download><Download size={16} />下载 Excel 模板</a></div>
                <div className="catalog-import__help">
                  <span>模板字段</span>
                  <strong>课时序号、课时名称可留空；留空时写入当前选中的课时。必填：日文、假名、释义。</strong>
                </div>
                <textarea value={importText} onChange={event => { setImportText(event.target.value); setPreview(null); }} placeholder="上传 XLSX/CSV，或直接粘贴表格内容。课时序号和课时名称可留空，留空时写入当前选中的课时。系统会先解析预览，不会立即写入。" />
                <div className="catalog-import-actions">
                  <label className="file-button"><Upload size={16} />上传 XLSX/CSV<input type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain" onChange={handleFile} /></label>
                  <button type="button" onClick={previewImport} disabled={working || !importText.trim()}><RefreshCw size={16} />解析预览</button>
                  <button type="button" onClick={commitImport} disabled={working || !preview || preview.summary.error > 0}>确认写入</button>
                  <button type="button" className="muted" onClick={clearImport} disabled={working || (!importText && !preview)}>清除</button>
                </div>
                {preview && (
                  <div className="catalog-preview">
                    <strong>共 {preview.summary.total} 行，新增 {preview.summary.create}，更新 {preview.summary.update}，不变 {preview.summary.same}，错误 {preview.summary.error}，需新建课时 {preview.summary.lessonsToCreate}</strong>
                    {preview.mapping && (
                      <p>自动匹配：{Object.values(preview.mapping).map(item => `${item.label}=${item.column ? `第${item.column}列` : '当前课时/空'}`).join('，')}</p>
                    )}
                    <div>
                      {preview.items.slice(0, 20).map(item => <p key={item.rowNumber} className={item.status === 'error' ? 'is-error' : ''}>第 {item.rowNumber} 行 · 第{item.lessonOrder}课 · {item.term || '空'} · {item.status}{item.errors.length ? `：${item.errors.join('、')}` : ''}</p>)}
                    </div>
                  </div>
                )}
              </section>

              <section className="catalog-editor">
                <div className="section-title"><h2>单个词条维护</h2><span>{selectedLesson ? `当前：第${selectedLesson.order}课 ${selectedLesson.title}` : '请先选择课时'}</span></div>
                <div className="mastery-toolbar">
                  <label><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索当前课时词条" /></label>
                  <strong>{words.length} 条</strong>
                </div>
                <form className="catalog-word-form" onSubmit={submitWord}>
                  <input value={wordForm.term} onChange={event => setWordForm(value => ({ ...value, term: event.target.value }))} placeholder="日文" />
                  <input value={wordForm.reading} onChange={event => setWordForm(value => ({ ...value, reading: event.target.value }))} placeholder="假名" />
                  <input value={wordForm.romaji} onChange={event => setWordForm(value => ({ ...value, romaji: event.target.value }))} placeholder="罗马音" />
                  <input value={wordForm.meaning} onChange={event => setWordForm(value => ({ ...value, meaning: event.target.value }))} placeholder="释义" />
                  <input value={wordForm.partOfSpeech} onChange={event => setWordForm(value => ({ ...value, partOfSpeech: event.target.value }))} placeholder="词性" />
                  <button type="submit" disabled={working || !selectedLesson || !wordForm.term || !wordForm.reading || !wordForm.meaning}>{editingWordId ? '保存词条' : '添加词条'}</button>
                </form>
                <div className="catalog-word-list">
                  {words.map(word => (
                    <article key={word.id}>
                      <div><strong>{word.term}</strong><span>{word.reading} · {word.romaji || '无罗马音'} · {word.meanings.join('；')}</span></div>
                      <small>{word.partOfSpeech || '未分类'}</small>
                      <button type="button" onClick={() => startEditWord(word)}><Pencil size={15} />编辑</button>
                      <button type="button" onClick={() => confirmDeleteWord(word)}><Trash2 size={15} />删除</button>
                    </article>
                  ))}
                  {!words.length && <p className="catalog-muted">当前课时还没有词条。</p>}
                </div>
              </section>
            </div>
          ) : <section className="mastery-empty"><FileSpreadsheet size={34} /><p>请先完成步骤 1。</p></section>}
        </section>
      </section>
    </main>
  );
}
