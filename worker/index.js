const MAX_TEXT_LENGTH = 200;
const ROOT_PASSWORD_HASH = '4813494d137e1631bba301d5acab6e7bb7aa74ce1185d456565ef51d737677b2';
const SESSION_DAYS = 30;
const MAX_DEVICES_PER_USER = 3;

const jsonResponse = (message, status) => new Response(JSON.stringify({ error: message }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

const dataResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

const requireDb = (env) => {
  if (!env.DB) throw new Response(JSON.stringify({ error: 'D1 database is not configured' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
  return env.DB;
};

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(item => item.toString(16).padStart(2, '0')).join('');
};

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(item => item.toString(16).padStart(2, '0')).join('');
};

const parseJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw jsonResponse('Invalid JSON', 400);
  }
};

const ensureRootUser = async (db) => {
  await db.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
  ).bind('user-root', 'root', ROOT_PASSWORD_HASH).run();
};

const getBearerToken = (request) => {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

const requireUser = async (request, env) => {
  const db = requireDb(env);
  const token = getBearerToken(request);
  if (!token) throw jsonResponse('Unauthorized', 401);
  const tokenHash = await sha256(token);
  const session = await db.prepare(
    'SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > CURRENT_TIMESTAMP'
  ).bind(tokenHash).first();
  if (!session) throw jsonResponse('Unauthorized', 401);
  return { db, user: session };
};

const handleTts = async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse('Invalid JSON', 400);
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return jsonResponse(`Text must contain 1-${MAX_TEXT_LENGTH} characters`, 400);
  }

  const googleUrl = new URL('https://translate.google.com/translate_tts');
  googleUrl.searchParams.set('ie', 'UTF-8');
  googleUrl.searchParams.set('client', 'tw-ob');
  googleUrl.searchParams.set('tl', 'ja');
  googleUrl.searchParams.set('q', text);

  const cacheUrl = new URL('/api/tts/cache', request.url);
  cacheUrl.searchParams.set('text', text);
  const cacheKey = new Request(cacheUrl);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let upstream;
  try {
    upstream = await fetch(googleUrl, {
      headers: {
        Accept: 'audio/mpeg',
        'User-Agent': 'Mozilla/5.0 (compatible; MinasanJapanesePWA/1.0)'
      }
    });
  } catch {
    return jsonResponse('Speech service unavailable', 502);
  }
  if (!upstream.ok || !upstream.body) return jsonResponse('Speech service unavailable', 502);

  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('Cache-Control', 'public, max-age=2592000');
  headers.delete('Set-Cookie');
  const response = new Response(upstream.body, { status: 200, headers });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const handleLogin = async (request, env) => {
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const db = requireDb(env);
  await ensureRootUser(db);
  const payload = await parseJson(request);
  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
  const deviceName = typeof payload.deviceName === 'string' ? payload.deviceName.trim().slice(0, 120) : '';
  const userAgent = typeof payload.userAgent === 'string' ? payload.userAgent.trim().slice(0, 300) : request.headers.get('User-Agent') || '';
  if (!deviceId) return jsonResponse('缺少设备码', 400);
  const passwordHash = await sha256(password);
  const user = await db.prepare('SELECT id, username FROM users WHERE username = ? AND password_hash = ?')
    .bind(username, passwordHash)
    .first();
  if (!user) return jsonResponse('用户名或密码不正确', 401);

  const existingDevice = await db.prepare('SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?')
    .bind(user.id, deviceId)
    .first();
  if (existingDevice) {
    await db.prepare('UPDATE user_devices SET device_name = ?, user_agent = ?, last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ? AND device_id = ?')
      .bind(deviceName, userAgent, user.id, deviceId)
      .run();
  } else {
    const deviceCount = await db.prepare('SELECT COUNT(*) AS count FROM user_devices WHERE user_id = ?')
      .bind(user.id)
      .first();
    if (Number(deviceCount?.count || 0) >= MAX_DEVICES_PER_USER) {
      return jsonResponse('设备数量已达上限，请先移除旧设备', 403);
    }
    await db.prepare('INSERT INTO user_devices (id, user_id, device_id, device_name, user_agent, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .bind(`device-${crypto.randomUUID()}`, user.id, deviceId, deviceName, userAgent)
      .run();
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(`session-${crypto.randomUUID()}`, user.id, tokenHash, expiresAt)
    .run();
  await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  return dataResponse({ token, user: { id: user.id, username: user.username }, expiresAt, deviceId });
};

const handleMe = async (request, env) => {
  if (request.method !== 'GET') return jsonResponse('Method not allowed', 405);
  const { user } = await requireUser(request, env);
  return dataResponse({ user });
};

const handleLogout = async (request, env) => {
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const { db } = await requireUser(request, env);
  const tokenHash = await sha256(getBearerToken(request));
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  return dataResponse({ ok: true });
};

const handleDuolingo = async (request, env) => {
  if (request.method !== 'GET') return jsonResponse('Method not allowed', 405);
  await requireUser(request, env);
  const db = requireDb(env);
  const course = await db.prepare('SELECT id, title, description FROM courses WHERE id = ?').bind('duolingo').first();
  if (!course) return dataResponse({ course: null, lessons: [], vocabulary: [], sentences: [] });
  const lessons = await db.prepare('SELECT id, course_id, title, order_index, description FROM lessons WHERE course_id = ? ORDER BY order_index ASC')
    .bind('duolingo')
    .all();
  const words = await db.prepare('SELECT id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, source_row FROM vocabulary WHERE course_id = ? ORDER BY source_row ASC')
    .bind('duolingo')
    .all();
  const lessonRows = lessons.results || [];
  const vocabularyRows = words.results || [];
  return dataResponse({
    course: {
      id: course.id,
      title: course.title,
      description: course.description,
      lessonIds: lessonRows.map(item => item.id)
    },
    lessons: lessonRows.map(item => ({
      id: item.id,
      courseId: item.course_id,
      order: item.order_index,
      title: item.title,
      description: item.description,
      vocabularyIds: vocabularyRows.filter(word => word.lesson_id === item.id).map(word => word.id),
      sentenceIds: []
    })),
    vocabulary: vocabularyRows.map(item => ({
      id: item.id,
      courseId: item.course_id,
      term: item.term,
      reading: item.reading,
      accents: [],
      accentDisplay: '',
      partOfSpeech: item.part_of_speech || '未分类',
      partOfSpeechCode: '',
      meanings: [item.meaning],
      sourceLesson: item.lesson_id,
      sourceLessonLabel: item.lesson_id,
      sourceSequence: item.source_row,
      sourceRow: item.source_row,
      romaji: item.romaji || ''
    })),
    sentences: []
  });
};

const progressRowsToRecords = (vocabularyRows, sentenceRows) => [
  ...vocabularyRows.map(item => ({
    id: item.vocabulary_id,
    lessonId: item.lesson_id,
    courseId: item.course_id,
    kind: 'vocabulary',
    correctCount: item.correct_count,
    wrongCount: item.wrong_count,
    lastPracticedAt: item.last_practiced_at
  })),
  ...sentenceRows.map(item => ({
    id: item.sentence_id,
    lessonId: item.lesson_id,
    courseId: item.course_id,
    kind: 'sentence',
    correctCount: item.correct_count,
    wrongCount: item.wrong_count,
    lastPracticedAt: item.last_practiced_at
  }))
];

const handleProgress = async (request, env) => {
  const { db, user } = await requireUser(request, env);
  if (request.method === 'GET') {
    const vocabularyRows = await db.prepare('SELECT * FROM vocabulary_progress WHERE user_id = ?').bind(user.id).all();
    const sentenceRows = await db.prepare('SELECT * FROM sentence_progress WHERE user_id = ?').bind(user.id).all();
    const lessonRows = await db.prepare('SELECT * FROM lesson_progress WHERE user_id = ?').bind(user.id).all();
    return dataResponse({
      records: progressRowsToRecords(vocabularyRows.results || [], sentenceRows.results || []),
      lessons: lessonRows.results || []
    });
  }
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);

  const payload = await parseJson(request);
  const kind = payload.kind === 'sentence' ? 'sentence' : payload.kind === 'lesson' ? 'lesson' : 'vocabulary';
  const courseId = typeof payload.courseId === 'string' && payload.courseId ? payload.courseId : 'beginner-01';
  const lessonId = typeof payload.lessonId === 'string' ? payload.lessonId : '';
  if (!lessonId) return jsonResponse('lessonId is required', 400);

  if (kind === 'lesson') {
    await db.prepare(`INSERT INTO lesson_progress (user_id, lesson_id, course_id, vocabulary_mastered_count, sentence_mastered_count, completed, last_studied_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET
        course_id = excluded.course_id,
        vocabulary_mastered_count = excluded.vocabulary_mastered_count,
        sentence_mastered_count = excluded.sentence_mastered_count,
        completed = excluded.completed,
        last_studied_at = CURRENT_TIMESTAMP`)
      .bind(user.id, lessonId, courseId, Number(payload.vocabularyMasteredCount || 0), Number(payload.sentenceMasteredCount || 0), payload.completed ? 1 : 0)
      .run();
    return dataResponse({ ok: true });
  }

  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return jsonResponse('id is required', 400);
  const correct = Boolean(payload.correct);
  const table = kind === 'sentence' ? 'sentence_progress' : 'vocabulary_progress';
  const idColumn = kind === 'sentence' ? 'sentence_id' : 'vocabulary_id';
  await db.prepare(`INSERT INTO ${table} (user_id, ${idColumn}, lesson_id, course_id, correct_count, wrong_count, mastered, last_practiced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET
      lesson_id = excluded.lesson_id,
      course_id = excluded.course_id,
      correct_count = correct_count + ?,
      wrong_count = wrong_count + ?,
      mastered = CASE WHEN (correct_count + ?) >= 2 AND (wrong_count + ?) = 0 THEN 1 ELSE 0 END,
      last_practiced_at = CURRENT_TIMESTAMP`)
    .bind(user.id, id, lessonId, courseId, correct ? 1 : 0, correct ? 0 : 1, correct ? 1 : 0, correct ? 0 : 1, correct ? 1 : 0, correct ? 0 : 1)
    .run();
  return dataResponse({ ok: true });
};

export default {
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/tts') return handleTts(request, context);
      if (url.pathname === '/api/login') return handleLogin(request, env);
      if (url.pathname === '/api/me') return handleMe(request, env);
      if (url.pathname === '/api/logout') return handleLogout(request, env);
      if (url.pathname === '/api/duolingo') return handleDuolingo(request, env);
      if (url.pathname === '/api/progress') return handleProgress(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      return jsonResponse('Internal server error', 500);
    }
  }
};
