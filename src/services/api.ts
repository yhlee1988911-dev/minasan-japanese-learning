import fallbackDuolingo from '../data/generated/duolingo-fallback.json';
import type { Lesson, Sentence, Vocabulary } from '../domain/models';
import type { MasteryRecord } from '../storage/mastery';

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

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY) || '';

export const setAuthToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);

export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);

export const getDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
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

export const loadDuolingoCourse = async (): Promise<DuolingoPayload> => {
  try {
    const data = await requestJson<DuolingoPayload>('/api/duolingo');
    return data.course ? data : fallbackDuolingo as DuolingoPayload;
  } catch {
    return fallbackDuolingo as DuolingoPayload;
  }
};

export const loadRemoteProgress = async () => requestJson<{ records: MasteryRecord[]; lessons: unknown[] }>('/api/progress');

export const sendProgressAttempt = async (payload: {
  id: string;
  lessonId: string;
  courseId?: string;
  kind: 'vocabulary' | 'sentence';
  correct: boolean;
}) => {
  await requestJson('/api/progress', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const sendLessonProgress = async (payload: {
  lessonId: string;
  courseId?: string;
  vocabularyMasteredCount: number;
  sentenceMasteredCount: number;
  completed: boolean;
}) => {
  await requestJson('/api/progress', {
    method: 'POST',
    body: JSON.stringify({ ...payload, kind: 'lesson' })
  });
};
