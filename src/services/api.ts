import type { Course, Lesson, Sentence, Vocabulary } from '../domain/models';
import type { MasteryRecord } from '../storage/mastery';
import type { MistakeRecord } from '../storage/mistakes';

const TOKEN_KEY = 'minasan_auth_token_v1';
const DEVICE_KEY = 'minasan_device_id_v1';
const LAST_USERNAME_KEY = 'minasan_last_username_v1';

export interface AuthUser {
  id: string;
  username: string;
}

export interface CatalogPayload {
  courses: Course[];
  lessons: Lesson[];
  vocabulary: Vocabulary[];
  sentences: Sentence[];
}

export interface AdminUser {
  id: string;
  username: string;
  created_at: string;
  last_login_at: string | null;
  device_count: number;
  session_count: number;
}

export interface AdminDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  user_agent: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AdminUsersPayload {
  users: AdminUser[];
  devices: AdminDevice[];
}

export interface LessonProgressRecord {
  lessonId: string;
  courseId: string;
  vocabularyMasteredCount: number;
  sentenceMasteredCount: number;
  completed: boolean;
  lastStudiedAt: string;
}

export interface CatalogImportPreviewItem {
  rowNumber: number;
  lessonOrder: number;
  lessonTitle: string;
  term: string;
  reading: string;
  romaji: string;
  meaning: string;
  partOfSpeech: string;
  tags: string;
  lessonId: string;
  status: 'create' | 'update' | 'same' | 'error';
  errors: string[];
}

export interface CatalogImportPreview {
  items: CatalogImportPreviewItem[];
  mapping?: Record<string, { label: string; column: number | null }> | null;
  lessonsToCreate: { order: number; title: string }[];
  summary: {
    total: number;
    create: number;
    update: number;
    same: number;
    error: number;
    lessonsToCreate: number;
  };
}

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY) || '';

export const setAuthToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);

export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);

export const getLastUsername = () => localStorage.getItem(LAST_USERNAME_KEY) || '';

export const setLastUsername = (username: string) => {
  const value = username.trim();
  if (value) localStorage.setItem(LAST_USERNAME_KEY, value);
};

const createDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const parts = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${parts.slice(0, 4).join('')}-${parts.slice(4, 6).join('')}-${parts.slice(6, 8).join('')}-${parts.slice(8, 10).join('')}-${parts.slice(10).join('')}`;
};

export const getDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const next = createDeviceId();
  localStorage.setItem(DEVICE_KEY, next);
  return next;
};

export const getDeviceName = () => {
  const platform = navigator.platform || 'Unknown platform';
  const userAgent = navigator.userAgent || '';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Mac/i.test(platform)) return 'Mac';
  if (/Win/i.test(platform)) return 'Windows';
  return platform;
};

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, {
    ...init,
    headers
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const onVisible = (callback: () => void) => {
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') callback();
  };
  window.addEventListener('focus', callback);
  document.addEventListener('visibilitychange', handleVisibility);
  return () => {
    window.removeEventListener('focus', callback);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
};

export const login = async (username: string, password: string) => {
  const deviceId = getDeviceId();
  const data = await requestJson<{ token: string; user: AuthUser; expiresAt: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      deviceId,
      deviceName: getDeviceName(),
      userAgent: navigator.userAgent || ''
    })
  });
  setAuthToken(data.token);
  setLastUsername(data.user.username || username);
  return data.user;
};

export const getMe = async () => requestJson<{ user: AuthUser }>('/api/me');

export const logout = async () => {
  try {
    await requestJson('/api/logout', { method: 'POST', body: '{}' });
  } finally {
    clearAuthToken();
  }
};

export const changePassword = async (currentPassword: string, newPassword: string) => requestJson<{ ok: true }>('/api/password', {
  method: 'POST',
  body: JSON.stringify({ currentPassword, newPassword })
});

export const loadAdminUsers = async () => requestJson<AdminUsersPayload>('/api/admin/users');

export const createAdminUser = async (username: string, password: string) => requestJson<AdminUsersPayload>('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ action: 'create', username, password })
});

export const clearAdminUserDevices = async (userId: string) => requestJson<AdminUsersPayload>('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ action: 'clearDevices', userId })
});

export const resetAdminUserPassword = async (userId: string) => requestJson<AdminUsersPayload>('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ action: 'resetPassword', userId })
});

export const deleteAdminUser = async (userId: string) => requestJson<AdminUsersPayload>('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ action: 'delete', userId })
});

export const loadCatalog = async (): Promise<CatalogPayload> => requestJson<CatalogPayload>(`/api/catalog?t=${Date.now()}`, { cache: 'no-store' });

export const manageCatalog = async <T = CatalogPayload>(payload: Record<string, unknown>) => requestJson<T>('/api/catalog', {
  method: 'POST',
  body: JSON.stringify(payload)
});

export const createCatalogCourse = async (title: string, description = '', ownerType: 'system' | 'user' = 'user') => manageCatalog({
  action: 'createCourse',
  title,
  description,
  ownerType
});

export const updateCatalogCourse = async (courseId: string, title: string, description = '') => manageCatalog({
  action: 'updateCourse',
  courseId,
  title,
  description
});

export const deleteCatalogCourse = async (courseId: string) => manageCatalog({
  action: 'deleteCourse',
  courseId
});

export const shareCatalogCourse = async (courseId: string, targetUserIds: string) => manageCatalog<{
  ok: true;
  shared: Array<{ userId: string; username: string; courseId: string; title: string; lessons: number; vocabulary: number; sentences: number }>;
  skipped: Array<{ target: string; userId?: string; username?: string; reason: string }>;
  catalog: CatalogPayload;
}>({
  action: 'shareCourse',
  courseId,
  targetUserIds
});

export const createCatalogLesson = async (courseId: string, order: number, title: string, description = '') => manageCatalog({
  action: 'createLesson',
  courseId,
  order,
  title,
  description
});

export const updateCatalogLesson = async (lessonId: string, title: string, description = '') => manageCatalog({
  action: 'updateLesson',
  lessonId,
  title,
  description
});

export const deleteCatalogLesson = async (lessonId: string) => manageCatalog({
  action: 'deleteLesson',
  lessonId
});

export const createCatalogWord = async (payload: {
  lessonId: string;
  term: string;
  reading: string;
  meaning: string;
  romaji?: string;
  partOfSpeech?: string;
  tags?: string;
}) => manageCatalog({ action: 'createWord', ...payload });

export const updateCatalogWord = async (payload: {
  wordId: string;
  lessonId: string;
  term: string;
  reading: string;
  meaning: string;
  romaji?: string;
  partOfSpeech?: string;
  tags?: string;
}) => manageCatalog({ action: 'updateWord', ...payload });

export const deleteCatalogWord = async (wordId: string) => manageCatalog({
  action: 'deleteWord',
  wordId
});

export const previewCatalogImport = async (courseId: string, text: string, lessonId = '') => manageCatalog<CatalogImportPreview>({
  action: 'previewImport',
  courseId,
  lessonId,
  text
});

export const commitCatalogImport = async (courseId: string, text: string, lessonId = '') => manageCatalog<{ ok: true; created: number; updated: number; skipped: number; lessonsCreated: number }>({
  action: 'commitImport',
  courseId,
  lessonId,
  text
});

export const loadRemoteProgress = async () => requestJson<{ records: MasteryRecord[]; lessons: unknown[]; mistakes: MistakeRecord[] }>('/api/progress');

export const sendProgressAttempt = async (payload: {
  id: string;
  lessonId: string;
  courseId?: string;
  kind: 'vocabulary' | 'sentence';
  correct: boolean;
  mastered?: boolean;
}) => {
  return requestJson<{ ok: true; record: MasteryRecord }>('/api/progress', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const sendRemoveMastery = async (payload: {
  id: string;
  lessonId: string;
  courseId?: string;
  kind: 'vocabulary' | 'sentence';
}) => {
  return requestJson<{ ok: true; record: MasteryRecord }>('/api/progress', {
    method: 'POST',
    body: JSON.stringify({ ...payload, action: 'removeMastery' })
  });
};

export const sendMistake = async (record: MistakeRecord) => requestJson<{ ok: true; record: MistakeRecord }>('/api/progress', {
  method: 'POST',
  body: JSON.stringify({
    kind: 'mistake',
    action: 'recordMistake',
    ...record
  })
});

export const sendRemoveMistake = async (key: string) => requestJson<{ ok: true; key: string }>('/api/progress', {
  method: 'POST',
  body: JSON.stringify({ kind: 'mistake', action: 'removeMistake', key })
});

export const sendLessonProgress = async (payload: {
  lessonId: string;
  courseId?: string;
  vocabularyMasteredCount: number;
  sentenceMasteredCount: number;
  completed: boolean;
}) => {
  return requestJson<{ ok: true; lesson: LessonProgressRecord }>('/api/progress', {
    method: 'POST',
    body: JSON.stringify({ ...payload, kind: 'lesson' })
  });
};
