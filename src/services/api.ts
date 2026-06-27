import fallbackDuolingo from '../data/generated/duolingo-fallback.json';
import type { Lesson, Sentence, Vocabulary } from '../domain/models';
import type { MasteryRecord } from '../storage/mastery';
import type { MistakeRecord } from '../storage/mistakes';

const TOKEN_KEY = 'minasan_auth_token_v1';
const DEVICE_KEY = 'minasan_device_id_v1';

export interface AuthUser {
  id: string;
  username: string;
}

export interface DuolingoPayload {
  course: { id: string; title: string; description: string; lessonIds: string[] } | null;
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

export interface AdminDuolingoLesson {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  description: string;
  vocabulary_count: number;
}

export interface AdminDuolingoWord {
  id: string;
  course_id: string;
  lesson_id: string;
  term: string;
  reading: string;
  meaning: string;
  romaji: string;
  part_of_speech: string;
  tags: string;
  source_row: number;
  updated_at: string;
  is_active: number;
  deleted_at: string | null;
}

export interface AdminDuolingoPayload {
  course: { id: string; title: string; description: string } | null;
  lessons: AdminDuolingoLesson[];
  vocabulary: AdminDuolingoWord[];
}

export interface AdminDuolingoPreviewItem {
  rowNumber: number;
  id: string;
  term: string;
  reading: string;
  romaji: string;
  meaning: string;
  partOfSpeech: string;
  lessonId: string;
  status: 'create' | 'update' | 'same' | 'error';
  errors: string[];
  previous: AdminDuolingoWord | null;
}

export interface AdminDuolingoPreviewPayload {
  items: AdminDuolingoPreviewItem[];
  summary: {
    total: number;
    create: number;
    update: number;
    same: number;
    error: number;
  };
}

export interface LessonProgressRecord {
  lessonId: string;
  courseId: string;
  vocabularyMasteredCount: number;
  sentenceMasteredCount: number;
  completed: boolean;
  lastStudiedAt: string;
}

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY) || '';

export const setAuthToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);

export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);

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

export const deleteAdminUser = async (userId: string) => requestJson<AdminUsersPayload>('/api/admin/users', {
  method: 'POST',
  body: JSON.stringify({ action: 'delete', userId })
});

export const loadAdminDuolingo = async () => requestJson<AdminDuolingoPayload>('/api/admin/duolingo');

export const previewAdminDuolingoImport = async (text: string, lessonId: string) => requestJson<AdminDuolingoPreviewPayload>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'previewImport', text, lessonId })
});

export const commitAdminDuolingoImport = async (text: string, lessonId: string) => requestJson<{ ok: true; created: number; updated: number; skipped: number; errors: number }>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'commitImport', text, lessonId })
});

export const deleteAdminDuolingoWord = async (id: string) => requestJson<{ ok: true }>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'deleteWord', id })
});

export const createAdminDuolingoLesson = async (payload: {
  lessonId?: string;
  title: string;
  order?: number;
  description?: string;
}) => requestJson<AdminDuolingoPayload>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'createLesson', ...payload })
});

export const updateAdminDuolingoLesson = async (payload: {
  id: string;
  title: string;
  description?: string;
}) => requestJson<AdminDuolingoPayload>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'updateLesson', ...payload })
});

export const updateAdminDuolingoWord = async (payload: {
  id: string;
  term: string;
  reading: string;
  meaning: string;
  romaji: string;
  partOfSpeech: string;
  lessonId: string;
}) => requestJson<AdminDuolingoPayload>('/api/admin/duolingo', {
  method: 'POST',
  body: JSON.stringify({ action: 'updateWord', ...payload })
});

export const loadDuolingoCourse = async (): Promise<DuolingoPayload> => {
  try {
    const data = await requestJson<DuolingoPayload>(`/api/duolingo?t=${Date.now()}`, { cache: 'no-store' });
    return data.course ? data : fallbackDuolingo as DuolingoPayload;
  } catch {
    return fallbackDuolingo as DuolingoPayload;
  }
};

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
    ...record,
    courseId: 'duolingo'
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
