import { AlertTriangle, Database, FileSpreadsheet, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  clearAdminUserDevices,
  commitAdminDuolingoImport,
  createAdminDuolingoLesson,
  createAdminUser,
  deleteAdminUser,
  deleteAdminDuolingoWord,
  loadAdminDuolingo,
  loadAdminUsers,
  previewAdminDuolingoImport,
  updateAdminDuolingoWord,
  type AdminDevice,
  type AdminDuolingoLesson,
  type AdminDuolingoPreviewPayload,
  type AdminDuolingoWord,
  type AdminUser,
  type AdminUsersPayload
} from '../services/api';

const applyPayload = (
  payload: AdminUsersPayload,
  setUsers: (users: AdminUser[]) => void,
  setDevices: (devices: AdminDevice[]) => void
) => {
  setUsers(payload.users);
  setDevices(payload.devices);
};

const formatDate = (value: string | null) => {
  if (!value) return '未登录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'duolingo'>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [duolingoLessons, setDuolingoLessons] = useState<AdminDuolingoLesson[]>([]);
  const [duolingoWords, setDuolingoWords] = useState<AdminDuolingoWord[]>([]);
  const [duolingoSearch, setDuolingoSearch] = useState('');
  const [importLessonId, setImportLessonId] = useState('duolingo-lesson-01');
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<AdminDuolingoPreviewPayload | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newLessonOrder, setNewLessonOrder] = useState('');
  const [editingWordId, setEditingWordId] = useState('');
  const [wordDraft, setWordDraft] = useState({
    term: '',
    reading: '',
    meaning: '',
    romaji: '',
    partOfSpeech: '',
    lessonId: ''
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const deviceMap = useMemo(() => {
    const next = new Map<string, AdminDevice[]>();
    devices.forEach(device => {
      next.set(device.user_id, [...(next.get(device.user_id) || []), device]);
    });
    return next;
  }, [devices]);

  const refresh = async () => {
    setError('');
    if (activeTab === 'duolingo') {
      const payload = await loadAdminDuolingo();
      setDuolingoLessons(payload.lessons);
      setDuolingoWords(payload.vocabulary);
      if (!payload.lessons.some(lesson => lesson.id === importLessonId) && payload.lessons[0]) setImportLessonId(payload.lessons[0].id);
      return;
    }
    const payload = await loadAdminUsers();
    applyPayload(payload, setUsers, setDevices);
  };

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(err => setError(err instanceof Error ? err.message : '读取后台数据失败'))
      .finally(() => setLoading(false));
  }, [activeTab]);

  const filteredWords = useMemo(() => {
    const keyword = duolingoSearch.trim().toLowerCase();
    if (!keyword) return duolingoWords.filter(word => Number(word.is_active) === 1).slice(0, 120);
    return duolingoWords.filter(word => Number(word.is_active) === 1 && [
      word.term,
      word.reading,
      word.meaning,
      word.romaji,
      word.lesson_id,
      word.part_of_speech
    ].some(value => String(value || '').toLowerCase().includes(keyword))).slice(0, 120);
  }, [duolingoSearch, duolingoWords]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const payload = await createAdminUser(username, password);
      applyPayload(payload, setUsers, setDevices);
      setUsername('');
      setPassword('');
      setMessage('账户已添加');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加账户失败');
    }
  };

  const clearDevices = async (user: AdminUser) => {
    setWorkingId(user.id);
    setMessage('');
    setError('');
    try {
      const payload = await clearAdminUserDevices(user.id);
      applyPayload(payload, setUsers, setDevices);
      setMessage(`${user.username} 的设备登录码已清空`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空设备失败');
    } finally {
      setWorkingId('');
    }
  };

  const removeUser = async (user: AdminUser) => {
    if (!window.confirm(`删除账户 ${user.username}？此操作会清除该账户的登录状态、设备码和学习进度。`)) return;
    setWorkingId(user.id);
    setMessage('');
    setError('');
    try {
      const payload = await deleteAdminUser(user.id);
      applyPayload(payload, setUsers, setDevices);
      setMessage(`${user.username} 已删除`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除账户失败');
    } finally {
      setWorkingId('');
    }
  };

  const previewImport = async () => {
    setMessage('');
    setError('');
    try {
      const payload = await previewAdminDuolingoImport(importText, importLessonId);
      setPreview(payload);
      setMessage(`已解析 ${payload.summary.total} 行：新增 ${payload.summary.create}，更新 ${payload.summary.update}，错误 ${payload.summary.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析导入内容失败');
    }
  };

  const commitImport = async () => {
    if (!preview || preview.summary.error > 0) return;
    setMessage('');
    setError('');
    try {
      const result = await commitAdminDuolingoImport(importText, importLessonId);
      setPreview(null);
      setImportText('');
      setMessage(`已写入 D1：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
      const payload = await loadAdminDuolingo();
      setDuolingoLessons(payload.lessons);
      setDuolingoWords(payload.vocabulary);
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认导入失败');
    }
  };

  const removeWord = async (word: AdminDuolingoWord) => {
    if (!window.confirm(`从练习词库中移除 ${word.term}？历史学习进度会保留。`)) return;
    setMessage('');
    setError('');
    try {
      await deleteAdminDuolingoWord(word.id);
      setDuolingoWords(words => words.map(item => item.id === word.id ? { ...item, is_active: 0, deleted_at: new Date().toISOString() } : item));
      setMessage(`${word.term} 已从 Duolingo 练习词库移除`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除词汇失败');
    }
  };

  const createLesson = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const payload = await createAdminDuolingoLesson({
        title: newLessonTitle,
        order: Number(newLessonOrder) || undefined
      });
      setDuolingoLessons(payload.lessons);
      setDuolingoWords(payload.vocabulary);
      const created = payload.lessons.find(lesson => lesson.title === newLessonTitle) || payload.lessons[payload.lessons.length - 1];
      if (created) setImportLessonId(created.id);
      setNewLessonTitle('');
      setNewLessonOrder('');
      setMessage('课时已添加，可在批量导入中选择');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加课时失败');
    }
  };

  const startEditWord = (word: AdminDuolingoWord) => {
    setEditingWordId(word.id);
    setWordDraft({
      term: word.term,
      reading: word.reading,
      meaning: word.meaning,
      romaji: word.romaji || '',
      partOfSpeech: word.part_of_speech || '未分类',
      lessonId: word.lesson_id
    });
  };

  const saveWord = async (word: AdminDuolingoWord) => {
    setMessage('');
    setError('');
    setEditingWordId('');
    try {
      const payload = await updateAdminDuolingoWord({
        id: word.id,
        ...wordDraft
      });
      setDuolingoLessons(payload.lessons);
      setDuolingoWords(payload.vocabulary);
      setMessage(`${wordDraft.term} 已保存`);
    } catch (err) {
      setEditingWordId(word.id);
      setError(err instanceof Error ? err.message : '保存词汇失败');
    }
  };

  return (
    <main className="admin-page">
      <section className="page-heading admin-heading">
        <div>
          <p className="eyebrow">ROOT ADMIN</p>
          <h1>后台管理</h1>
          <p>D1 账户、设备登录码与登录状态集中管理。</p>
        </div>
        <button className="admin-refresh" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={17} />刷新
        </button>
      </section>

      <nav className="admin-tabs" aria-label="后台管理分类">
        <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}><UsersRound size={17} />账户</button>
        <button className={activeTab === 'duolingo' ? 'active' : ''} onClick={() => setActiveTab('duolingo')}><Database size={17} />Duolingo 词库</button>
      </nav>

      {(message || error) && <p className={error ? 'admin-feedback is-error' : 'admin-feedback'}>{error || message}</p>}

      {activeTab === 'users' && (
        <>
      <section className="admin-summary" aria-label="后台统计">
        <div><UsersRound size={20} /><span>账户</span><strong>{users.length}</strong></div>
        <div><KeyRound size={20} /><span>设备码</span><strong>{devices.length}</strong></div>
        <div><ShieldCheck size={20} /><span>活动会话</span><strong>{users.reduce((sum, user) => sum + Number(user.session_count || 0), 0)}</strong></div>
      </section>

      <section className="admin-grid">
        <form className="admin-panel admin-create" onSubmit={submit}>
          <div className="admin-panel__title">
            <Plus size={20} />
            <div><h2>添加账户</h2><p>新账户可使用同一学习系统登录。</p></div>
          </div>
          <label>
            <span>用户名</span>
            <input value={username} onChange={event => setUsername(event.target.value)} placeholder="user_name" autoComplete="off" />
          </label>
          <label>
            <span>初始密码</span>
            <input value={password} onChange={event => setPassword(event.target.value)} type="password" placeholder="至少 8 位" autoComplete="new-password" />
          </label>
          <button type="submit" disabled={!username || !password}>添加账户</button>
        </form>

        <section className="admin-panel admin-notice">
          <div className="admin-panel__title">
            <AlertTriangle size={20} />
            <div><h2>管理说明</h2><p>清空设备码后，该账户可重新绑定最多 3 台设备。</p></div>
          </div>
          <p>删除账户会同步移除该账户的登录状态、设备码和学习进度。`root` 管理员不可删除。</p>
        </section>
      </section>

      <section className="admin-panel admin-users">
        <div className="admin-panel__title">
          <UsersRound size={20} />
          <div><h2>账户列表</h2><p>{loading ? '正在读取 D1 数据' : `共 ${users.length} 个账户`}</p></div>
        </div>
        <div className="admin-table" role="table" aria-label="账户管理">
          <div className="admin-table__head" role="row">
            <span>账户</span>
            <span>设备</span>
            <span>最近登录</span>
            <span>操作</span>
          </div>
          {users.map(user => {
            const userDevices = deviceMap.get(user.id) || [];
            return (
              <article className="admin-user-row" key={user.id} role="row">
                <div>
                  <strong>{user.username}</strong>
                  <small>{user.id}</small>
                </div>
                <div>
                  <b>{user.device_count}</b>
                  <small>{userDevices[0]?.device_name || '暂无设备'}</small>
                </div>
                <div>
                  <span>{formatDate(user.last_login_at)}</span>
                  <small>会话 {user.session_count}</small>
                </div>
                <div className="admin-actions">
                  <button onClick={() => void clearDevices(user)} disabled={workingId === user.id || Number(user.device_count) === 0}>
                    <KeyRound size={16} />清空设备
                  </button>
                  <button className="danger" onClick={() => void removeUser(user)} disabled={workingId === user.id || user.username === 'root'}>
                    <Trash2 size={16} />删除
                  </button>
                </div>
                {userDevices.length > 0 && (
                  <div className="admin-devices">
                    {userDevices.map(device => (
                      <span key={device.id}>{device.device_name || '未知设备'} · {device.device_id.slice(0, 8)} · {formatDate(device.last_seen_at)}</span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
        </>
      )}

      {activeTab === 'duolingo' && (
        <>
          <section className="admin-summary" aria-label="Duolingo 词库统计">
            <div><Database size={20} /><span>启用词汇</span><strong>{duolingoWords.filter(word => Number(word.is_active) === 1).length}</strong></div>
            <div><FileSpreadsheet size={20} /><span>课时</span><strong>{duolingoLessons.length}</strong></div>
            <div><Trash2 size={20} /><span>已移除</span><strong>{duolingoWords.filter(word => Number(word.is_active) !== 1).length}</strong></div>
          </section>

          <section className="admin-panel admin-import">
            <div className="admin-panel__title">
              <FileSpreadsheet size={20} />
              <div><h2>批量粘贴导入</h2><p>先添加或选择课时，再从 Excel 粘贴：日文、假名、罗马音、释义、词性。</p></div>
            </div>
            <form className="admin-lesson-create" onSubmit={createLesson}>
              <label>
                <span>新增课时名称</span>
                <input value={newLessonTitle} onChange={event => setNewLessonTitle(event.target.value)} placeholder="duolingo 11" />
              </label>
              <label>
                <span>排序</span>
                <input value={newLessonOrder} onChange={event => setNewLessonOrder(event.target.value)} inputMode="numeric" placeholder="自动" />
              </label>
              <button type="submit" disabled={!newLessonTitle.trim()}>添加课时</button>
            </form>
            <div className="admin-import__controls">
              <label>
                <span>选择课时</span>
                <select value={importLessonId} onChange={event => setImportLessonId(event.target.value)}>
                  {duolingoLessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title} · {lesson.id}</option>)}
                </select>
              </label>
              <button onClick={() => void previewImport()} disabled={!importText.trim()}>解析预览</button>
              <button className="primary" onClick={() => void commitImport()} disabled={!preview || preview.summary.error > 0}>确认写入</button>
            </div>
            <textarea
              value={importText}
              onChange={event => {
                setImportText(event.target.value);
                setPreview(null);
              }}
              placeholder={'日文\t假名\t罗马音\t释义\t词性\n食べます\tたべます\ttabemasu\t吃\t动词\n飲みます\tのみます\tnomimasu\t喝\t动词'}
            />
            {preview && (
              <div className="admin-preview">
                <div className="admin-preview__summary">
                  <span>总计 {preview.summary.total}</span>
                  <b>新增 {preview.summary.create}</b>
                  <b>更新 {preview.summary.update}</b>
                  <b>无变化 {preview.summary.same}</b>
                  <b className={preview.summary.error ? 'is-error' : ''}>错误 {preview.summary.error}</b>
                </div>
                <div className="admin-preview__table">
                  {preview.items.slice(0, 80).map(item => (
                    <article className={`admin-preview__row is-${item.status}`} key={`${item.rowNumber}-${item.term}-${item.reading}`}>
                      <span>{item.rowNumber}</span>
                      <strong>{item.term || '缺少日文'}</strong>
                      <small>{item.reading || '缺少假名'}</small>
                      <small>{item.meaning || '缺少释义'}</small>
                      <em>{item.errors.length ? item.errors.join('、') : item.status}</em>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="admin-panel admin-users">
            <div className="admin-panel__title">
              <Database size={20} />
              <div><h2>Duolingo 词汇</h2><p>搜索后最多显示前 120 条，删除为软删除。</p></div>
            </div>
            <input className="admin-search" value={duolingoSearch} onChange={event => setDuolingoSearch(event.target.value)} placeholder="搜索日文、假名、释义、罗马音、课时" />
            <div className="admin-word-list">
              {filteredWords.map(word => (
                <article key={word.id}>
                  {editingWordId === word.id ? (
                    <>
                      <label><span>日文</span><input value={wordDraft.term} onChange={event => setWordDraft(draft => ({ ...draft, term: event.target.value }))} /></label>
                      <label><span>假名</span><input value={wordDraft.reading} onChange={event => setWordDraft(draft => ({ ...draft, reading: event.target.value }))} /></label>
                      <label><span>释义</span><input value={wordDraft.meaning} onChange={event => setWordDraft(draft => ({ ...draft, meaning: event.target.value }))} /></label>
                      <label><span>罗马音</span><input value={wordDraft.romaji} onChange={event => setWordDraft(draft => ({ ...draft, romaji: event.target.value }))} /></label>
                      <label><span>课时</span><select value={wordDraft.lessonId} onChange={event => setWordDraft(draft => ({ ...draft, lessonId: event.target.value }))}>{duolingoLessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></label>
                      <div className="admin-word-list__edit-actions">
                        <button onClick={() => void saveWord(word)} disabled={!wordDraft.term.trim() || !wordDraft.reading.trim() || !wordDraft.meaning.trim()}>保存</button>
                        <button className="muted" onClick={() => setEditingWordId('')}>取消</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div><strong>{word.term}</strong><small>{word.reading} · {word.romaji || '无罗马音'}</small></div>
                      <p>{word.meaning}</p>
                      <small>{word.lesson_id} · {word.part_of_speech || '未分类'}</small>
                      <div className="admin-word-list__actions">
                        <button onClick={() => startEditWord(word)}>编辑</button>
                        <button className="danger" onClick={() => void removeWord(word)}><Trash2 size={16} />移除</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
