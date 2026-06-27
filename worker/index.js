const MAX_TEXT_LENGTH = 200;
const ROOT_PASSWORD_HASH = 'a28373767b16f998af23afbd173e12fdecc355b3cd5a6f25ec80756bf39c82e5';
const SESSION_DAYS = 30;
const MAX_DEVICES_PER_USER = 3;

const jsonResponse = (message, status) => new Response(JSON.stringify({ error: message }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

const dataResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  }
});

const isResponse = (value) => value && typeof value === 'object'
  && typeof value.status === 'number'
  && typeof value.headers?.get === 'function'
  && typeof value.clone === 'function';

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
    `INSERT INTO users (id, username, password_hash, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(username) DO NOTHING`
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

const requireAdmin = async (request, env) => {
  const { db, user } = await requireUser(request, env);
  if (user.username !== 'root') throw jsonResponse('需要管理员权限', 403);
  return { db, user };
};

const ensureDuolingoAdminSchema = async (db) => {
  const columns = await db.prepare('PRAGMA table_info(vocabulary)').all();
  const names = new Set((columns.results || []).map(item => item.name));
  if (!names.has('is_active')) {
    await db.prepare('ALTER TABLE vocabulary ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1').run();
  }
  if (!names.has('deleted_at')) {
    await db.prepare('ALTER TABLE vocabulary ADD COLUMN deleted_at TEXT').run();
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_vocabulary_duolingo_lookup ON vocabulary(course_id, term, reading)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_vocabulary_active_lesson ON vocabulary(course_id, is_active, lesson_id)').run();
};

const ensureMistakeSchema = async (db) => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS mistake_progress (
    user_id TEXT NOT NULL,
    mistake_key TEXT NOT NULL,
    item_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    course_id TEXT NOT NULL DEFAULT 'duolingo',
    prompt TEXT NOT NULL DEFAULT '',
    meaning TEXT NOT NULL DEFAULT '',
    speech TEXT NOT NULL DEFAULT '',
    answers TEXT NOT NULL DEFAULT '[]',
    wrong_count INTEGER NOT NULL DEFAULT 1,
    last_wrong_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, mistake_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_mistake_progress_user_lesson ON mistake_progress(user_id, lesson_id)').run();
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
  } else if (user.username === 'root') {
    await db.prepare('INSERT INTO user_devices (id, user_id, device_id, device_name, user_agent, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .bind(`device-${crypto.randomUUID()}`, user.id, deviceId, deviceName, userAgent)
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

const handlePassword = async (request, env) => {
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const { db, user } = await requireUser(request, env);
  const payload = await parseJson(request);
  const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  if (newPassword.length < 8) return jsonResponse('新密码至少需要 8 位', 400);
  const currentHash = await sha256(currentPassword);
  const current = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!current || current.password_hash !== currentHash) return jsonResponse('当前密码不正确', 401);
  const newHash = await sha256(newPassword);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();
  const tokenHash = await sha256(getBearerToken(request));
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, tokenHash).run();
  return dataResponse({ ok: true });
};

const listAdminUsers = async (db) => {
  const users = await db.prepare(`SELECT
      users.id,
      users.username,
      users.created_at,
      users.last_login_at,
      COUNT(DISTINCT user_devices.id) AS device_count,
      COUNT(DISTINCT sessions.id) AS session_count
    FROM users
    LEFT JOIN user_devices ON user_devices.user_id = users.id
    LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > CURRENT_TIMESTAMP
    GROUP BY users.id, users.username, users.created_at, users.last_login_at
    ORDER BY CASE WHEN users.username = 'root' THEN 0 ELSE 1 END, users.created_at ASC`).all();

  const devices = await db.prepare(`SELECT
      user_devices.id,
      user_devices.user_id,
      user_devices.device_id,
      user_devices.device_name,
      user_devices.user_agent,
      user_devices.first_seen_at,
      user_devices.last_seen_at
    FROM user_devices
    ORDER BY user_devices.last_seen_at DESC`).all();

  return dataResponse({
    users: users.results || [],
    devices: devices.results || []
  });
};

const handleAdminUsers = async (request, env) => {
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const { db } = await requireAdmin(request, env);
  await ensureRootUser(db);
  await ensureMistakeSchema(db);

  if (request.method === 'GET') return listAdminUsers(db);

  const payload = await parseJson(request);
  const action = typeof payload.action === 'string' ? payload.action : '';

  if (action === 'create') {
    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) return jsonResponse('用户名需为 3-32 位字母、数字、下划线或短横线', 400);
    if (password.length < 8) return jsonResponse('密码至少需要 8 位', 400);
    const passwordHash = await sha256(password);
    try {
      await db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
        .bind(`user-${crypto.randomUUID()}`, username, passwordHash)
        .run();
    } catch {
      return jsonResponse('账户已存在', 409);
    }
    return listAdminUsers(db);
  }

  const userId = typeof payload.userId === 'string' ? payload.userId : '';
  if (!userId) return jsonResponse('缺少账户 ID', 400);

  if (action === 'clearDevices') {
    await db.prepare('DELETE FROM user_devices WHERE user_id = ?').bind(userId).run();
    return listAdminUsers(db);
  }

  if (action === 'delete') {
    const target = await db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first();
    if (!target) return jsonResponse('账户不存在', 404);
    if (target.username === 'root') return jsonResponse('不能删除 root 管理员', 400);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM user_devices WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM vocabulary_progress WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM sentence_progress WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM lesson_progress WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM mistake_progress WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    return listAdminUsers(db);
  }

  return jsonResponse('未知管理操作', 400);
};

const normalizeLessonId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^duolingo-lesson-\d+$/i.test(raw)) {
    const number = raw.match(/\d+$/)?.[0] || '1';
    return `duolingo-lesson-${String(Number(number)).padStart(2, '0')}`;
  }
  const number = raw.match(/\d+/)?.[0];
  return number ? `duolingo-lesson-${String(Number(number)).padStart(2, '0')}` : raw;
};

const normalizeCell = (value) => String(value || '').trim();

const parseDuolingoRows = (text, fallbackLessonId) => {
  const rows = String(text || '')
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);
  if (!rows.length) return [];

  const splitLine = (line) => line.includes('\t') ? line.split('\t') : line.split(',');
  const first = splitLine(rows[0]).map(item => item.trim().toLowerCase());
  const headerAliases = {
    term: ['日文', '词汇', '單詞', '单词', 'term', 'word'],
    reading: ['假名', '读音', '讀音', 'reading', 'kana'],
    romaji: ['注音', '罗马音', '羅馬音', 'romaji'],
    meaning: ['释义', '中文', '意思', 'meaning'],
    partOfSpeech: ['词性', '詞性', 'part_of_speech', 'pos'],
    lessonId: ['课时', '課時', 'lesson', 'lesson_id']
  };
  const hasHeader = first.some(cell => Object.values(headerAliases).some(names => names.includes(cell)));
  const indexFor = (key, fallback) => {
    const aliases = headerAliases[key];
    const index = first.findIndex(cell => aliases.includes(cell));
    return index >= 0 ? index : fallback;
  };
  const indexes = {
    term: hasHeader ? indexFor('term', 0) : 0,
    reading: hasHeader ? indexFor('reading', 1) : 1,
    romaji: hasHeader ? indexFor('romaji', 2) : 2,
    meaning: hasHeader ? indexFor('meaning', 3) : 3,
    partOfSpeech: hasHeader ? indexFor('partOfSpeech', 4) : 4,
    lessonId: hasHeader ? indexFor('lessonId', 5) : 5
  };

  return rows.slice(hasHeader ? 1 : 0).map((line, offset) => {
    const cells = splitLine(line);
    const rowNumber = offset + (hasHeader ? 2 : 1);
    return {
      rowNumber,
      term: normalizeCell(cells[indexes.term]),
      reading: normalizeCell(cells[indexes.reading]),
      romaji: normalizeCell(cells[indexes.romaji]),
      meaning: normalizeCell(cells[indexes.meaning]),
      partOfSpeech: normalizeCell(cells[indexes.partOfSpeech]) || '未分类',
      lessonId: normalizeLessonId(cells[indexes.lessonId] || fallbackLessonId)
    };
  });
};

const listDuolingoAdmin = async (db) => {
  await ensureDuolingoAdminSchema(db);
  const course = await db.prepare('SELECT id, title, description FROM courses WHERE id = ?').bind('duolingo').first();
  const lessons = await db.prepare(`SELECT
      lessons.id,
      lessons.course_id,
      lessons.title,
      lessons.order_index,
      lessons.description,
      COUNT(vocabulary.id) AS vocabulary_count
    FROM lessons
    LEFT JOIN vocabulary ON vocabulary.lesson_id = lessons.id AND vocabulary.course_id = lessons.course_id AND vocabulary.is_active = 1
    WHERE lessons.course_id = ?
    GROUP BY lessons.id, lessons.course_id, lessons.title, lessons.order_index, lessons.description
    ORDER BY lessons.order_index ASC`).bind('duolingo').all();
  const words = await db.prepare(`SELECT
      id,
      course_id,
      lesson_id,
      term,
      reading,
      meaning,
      romaji,
      part_of_speech,
      tags,
      source_row,
      updated_at,
      is_active,
      deleted_at
    FROM vocabulary
    WHERE course_id = ?
    ORDER BY is_active DESC, lesson_id ASC, source_row ASC, id ASC`).bind('duolingo').all();

  return dataResponse({
    course,
    lessons: lessons.results || [],
    vocabulary: words.results || []
  });
};

const previewDuolingoImport = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const rows = parseDuolingoRows(payload.text, payload.lessonId);
  const existing = await db.prepare('SELECT id, term, reading, lesson_id, meaning, romaji, part_of_speech, is_active FROM vocabulary WHERE course_id = ?')
    .bind('duolingo')
    .all();
  const existingMap = new Map((existing.results || []).map(item => [`${item.term}\u0000${item.reading}`, item]));
  const lessons = await db.prepare('SELECT id FROM lessons WHERE course_id = ?').bind('duolingo').all();
  const lessonIds = new Set((lessons.results || []).map(item => item.id));

  const items = rows.map(row => {
    const errors = [];
    if (!row.term) errors.push('缺少日文');
    if (!row.reading) errors.push('缺少假名');
    if (!row.meaning) errors.push('缺少释义');
    if (!row.lessonId) errors.push('缺少课时');
    if (row.lessonId && !lessonIds.has(row.lessonId)) errors.push('课时不存在');

    const current = existingMap.get(`${row.term}\u0000${row.reading}`);
    const changed = current && (
      current.lesson_id !== row.lessonId
      || current.meaning !== row.meaning
      || (current.romaji || '') !== row.romaji
      || (current.part_of_speech || '未分类') !== row.partOfSpeech
      || Number(current.is_active) !== 1
    );

    return {
      ...row,
      id: current?.id || '',
      status: errors.length ? 'error' : current ? changed ? 'update' : 'same' : 'create',
      errors,
      previous: current || null
    };
  });

  return dataResponse({
    items,
    summary: {
      total: items.length,
      create: items.filter(item => item.status === 'create').length,
      update: items.filter(item => item.status === 'update').length,
      same: items.filter(item => item.status === 'same').length,
      error: items.filter(item => item.status === 'error').length
    }
  });
};

const nextDuolingoVocabularyId = async (db) => {
  const row = await db.prepare("SELECT id FROM vocabulary WHERE course_id = 'duolingo' AND id LIKE 'duo-v-%' ORDER BY id DESC LIMIT 1").first();
  const next = Number(String(row?.id || '').match(/\d+$/)?.[0] || 0) + 1;
  return `duo-v-${String(next).padStart(4, '0')}`;
};

const commitDuolingoImport = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const preview = await previewDuolingoImport(db, payload);
  const data = await preview.json();
  const validItems = data.items.filter(item => item.status === 'create' || item.status === 'update');
  let created = 0;
  let updated = 0;

  for (const item of validItems) {
    if (item.status === 'update') {
      await db.prepare(`UPDATE vocabulary
        SET lesson_id = ?, meaning = ?, romaji = ?, part_of_speech = ?, is_active = 1, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND course_id = 'duolingo'`)
        .bind(item.lessonId, item.meaning, item.romaji, item.partOfSpeech, item.id)
        .run();
      updated += 1;
    } else {
      const id = await nextDuolingoVocabularyId(db);
      const maxRow = await db.prepare("SELECT COALESCE(MAX(source_row), 0) AS max_row FROM vocabulary WHERE course_id = 'duolingo'").first();
      await db.prepare(`INSERT INTO vocabulary
        (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at, is_active, deleted_at)
        VALUES (?, 'duolingo', ?, ?, ?, ?, ?, ?, '[]', ?, CURRENT_TIMESTAMP, 1, NULL)`)
        .bind(id, item.lessonId, item.term, item.reading, item.meaning, item.romaji, item.partOfSpeech, Number(maxRow?.max_row || 0) + 1)
        .run();
      created += 1;
    }
  }

  return dataResponse({ ok: true, created, updated, skipped: data.summary.same, errors: data.summary.error });
};

const createDuolingoLesson = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const title = normalizeCell(payload.title);
  const requestedId = normalizeLessonId(payload.lessonId);
  const maxLesson = await db.prepare("SELECT COALESCE(MAX(order_index), 0) AS max_order FROM lessons WHERE course_id = 'duolingo'").first();
  const order = Number(payload.order || 0) || Number(maxLesson?.max_order || 0) + 1;
  const lessonId = requestedId || `duolingo-lesson-${String(order).padStart(2, '0')}`;
  const lessonTitle = title || `duolingo ${order}`;
  const description = normalizeCell(payload.description) || '本课可通过后台批量导入 duolingo 词汇。';
  try {
    await db.prepare(`INSERT INTO lessons (id, course_id, title, order_index, description)
      VALUES (?, 'duolingo', ?, ?, ?)`)
      .bind(lessonId, lessonTitle, order, description)
      .run();
  } catch {
    return jsonResponse('课时已存在或排序冲突', 409);
  }
  return listDuolingoAdmin(db);
};

const updateDuolingoLesson = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const id = normalizeLessonId(payload.id);
  const title = normalizeCell(payload.title);
  const description = typeof payload.description === 'string' ? normalizeCell(payload.description) : null;
  if (!id) return jsonResponse('缺少课时 ID', 400);
  if (!title) return jsonResponse('课时名称不能为空', 400);
  const lesson = await db.prepare("SELECT id, description FROM lessons WHERE course_id = 'duolingo' AND id = ?").bind(id).first();
  if (!lesson) return jsonResponse('课时不存在', 404);
  await db.prepare(`UPDATE lessons
    SET title = ?, description = ?
    WHERE id = ? AND course_id = 'duolingo'`)
    .bind(title, description ?? lesson.description ?? '', id)
    .run();
  return listDuolingoAdmin(db);
};

const updateDuolingoWord = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const id = normalizeCell(payload.id);
  const term = normalizeCell(payload.term);
  const reading = normalizeCell(payload.reading);
  const meaning = normalizeCell(payload.meaning);
  const romaji = normalizeCell(payload.romaji);
  const partOfSpeech = normalizeCell(payload.partOfSpeech) || '未分类';
  const lessonId = normalizeLessonId(payload.lessonId);
  if (!id) return jsonResponse('缺少词汇 ID', 400);
  if (!term) return jsonResponse('缺少日文', 400);
  if (!reading) return jsonResponse('缺少假名', 400);
  if (!meaning) return jsonResponse('缺少释义', 400);
  const lesson = await db.prepare("SELECT id FROM lessons WHERE course_id = 'duolingo' AND id = ?").bind(lessonId).first();
  if (!lesson) return jsonResponse('课时不存在', 400);
  const existing = await db.prepare("SELECT id FROM vocabulary WHERE id = ? AND course_id = 'duolingo'").bind(id).first();
  if (!existing) return jsonResponse('词汇不存在', 404);
  const duplicate = await db.prepare(`SELECT id FROM vocabulary
    WHERE course_id = 'duolingo' AND id != ? AND term = ? AND reading = ? AND is_active = 1
    LIMIT 1`)
    .bind(id, term, reading)
    .first();
  if (duplicate) return jsonResponse('已有相同日文和假名的词条', 409);
  await db.prepare(`UPDATE vocabulary
    SET term = ?, reading = ?, meaning = ?, romaji = ?, part_of_speech = ?, lesson_id = ?, is_active = 1, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND course_id = 'duolingo'`)
    .bind(term, reading, meaning, romaji, partOfSpeech, lessonId, id)
    .run();
  return listDuolingoAdmin(db);
};

const deleteDuolingoWord = async (db, payload) => {
  await ensureDuolingoAdminSchema(db);
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return jsonResponse('缺少词汇 ID', 400);
  await db.prepare(`UPDATE vocabulary
    SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND course_id = 'duolingo'`)
    .bind(id)
    .run();
  return dataResponse({ ok: true });
};

const handleAdminDuolingo = async (request, env) => {
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const { db } = await requireAdmin(request, env);
  if (request.method === 'GET') return listDuolingoAdmin(db);

  const payload = await parseJson(request);
  if (payload.action === 'createLesson') return createDuolingoLesson(db, payload);
  if (payload.action === 'updateLesson') return updateDuolingoLesson(db, payload);
  if (payload.action === 'updateWord') return updateDuolingoWord(db, payload);
  if (payload.action === 'previewImport') return previewDuolingoImport(db, payload);
  if (payload.action === 'commitImport') return commitDuolingoImport(db, payload);
  if (payload.action === 'deleteWord') return deleteDuolingoWord(db, payload);
  return jsonResponse('未知 Duolingo 管理操作', 400);
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
  await ensureDuolingoAdminSchema(db);
  const words = await db.prepare('SELECT id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, source_row FROM vocabulary WHERE course_id = ? AND is_active = 1 ORDER BY source_row ASC')
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
    mastered: Boolean(item.mastered),
    lastPracticedAt: item.last_practiced_at
  })),
  ...sentenceRows.map(item => ({
    id: item.sentence_id,
    lessonId: item.lesson_id,
    courseId: item.course_id,
    kind: 'sentence',
    correctCount: item.correct_count,
    wrongCount: item.wrong_count,
    mastered: Boolean(item.mastered),
    lastPracticedAt: item.last_practiced_at
  }))
];

const progressRowToRecord = (item, kind) => ({
  id: kind === 'sentence' ? item.sentence_id : item.vocabulary_id,
  lessonId: item.lesson_id,
  courseId: item.course_id,
  kind,
  correctCount: item.correct_count,
  wrongCount: item.wrong_count,
  mastered: Boolean(item.mastered),
  lastPracticedAt: item.last_practiced_at
});

const lessonRowToRecord = (item) => ({
  lessonId: item.lesson_id,
  courseId: item.course_id,
  vocabularyMasteredCount: item.vocabulary_mastered_count,
  sentenceMasteredCount: item.sentence_mastered_count,
  completed: Boolean(item.completed),
  lastStudiedAt: item.last_studied_at
});

const parseAnswers = (value) => {
  try {
    const answers = JSON.parse(value || '[]');
    return Array.isArray(answers) ? answers.map(item => String(item)) : [];
  } catch {
    return [];
  }
};

const mistakeRowToRecord = (item) => ({
  key: item.mistake_key,
  id: item.item_id,
  mode: item.mode,
  lessonId: item.lesson_id,
  prompt: item.prompt,
  meaning: item.meaning,
  speech: item.speech,
  answers: parseAnswers(item.answers),
  wrongCount: item.wrong_count,
  lastWrongAt: item.last_wrong_at
});

const handleProgress = async (request, env) => {
  const { db, user } = await requireUser(request, env);
  await ensureMistakeSchema(db);
  if (request.method === 'GET') {
    const vocabularyRows = await db.prepare('SELECT * FROM vocabulary_progress WHERE user_id = ?').bind(user.id).all();
    const sentenceRows = await db.prepare('SELECT * FROM sentence_progress WHERE user_id = ?').bind(user.id).all();
    const lessonRows = await db.prepare('SELECT * FROM lesson_progress WHERE user_id = ?').bind(user.id).all();
    const mistakeRows = await db.prepare(`SELECT * FROM mistake_progress
      WHERE user_id = ? AND course_id = 'duolingo'
      ORDER BY last_wrong_at DESC`).bind(user.id).all();
    return dataResponse({
      records: progressRowsToRecords(vocabularyRows.results || [], sentenceRows.results || []),
      lessons: lessonRows.results || [],
      mistakes: (mistakeRows.results || []).map(mistakeRowToRecord)
    });
  }
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);

  const payload = await parseJson(request);
  const kind = payload.kind === 'sentence'
    ? 'sentence'
    : payload.kind === 'lesson'
      ? 'lesson'
      : payload.kind === 'mistake'
        ? 'mistake'
        : 'vocabulary';
  if (kind === 'mistake') {
    const key = typeof payload.key === 'string' ? payload.key.trim() : '';
    if (!key) return jsonResponse('key is required', 400);
    if (payload.action === 'removeMistake') {
      await db.prepare('DELETE FROM mistake_progress WHERE user_id = ? AND mistake_key = ?')
        .bind(user.id, key)
        .run();
      return dataResponse({ ok: true, key });
    }

    const lessonId = typeof payload.lessonId === 'string' ? payload.lessonId.trim() : '';
    if (!lessonId.startsWith('duolingo-')) return jsonResponse('仅同步 Duolingo 错题', 400);
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return jsonResponse('id is required', 400);
    const mode = typeof payload.mode === 'string' ? payload.mode.trim() : 'translation';
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.slice(0, 500) : '';
    const meaning = typeof payload.meaning === 'string' ? payload.meaning.slice(0, 500) : '';
    const speech = typeof payload.speech === 'string' ? payload.speech.slice(0, 500) : '';
    const answers = Array.isArray(payload.answers)
      ? payload.answers.map(item => String(item).slice(0, 200)).filter(Boolean)
      : [];
    const wrongCount = Math.max(1, Number(payload.wrongCount || 1));
    const lastWrongAt = typeof payload.lastWrongAt === 'string' && payload.lastWrongAt ? payload.lastWrongAt : new Date().toISOString();

    await db.prepare(`INSERT INTO mistake_progress
      (user_id, mistake_key, item_id, mode, lesson_id, course_id, prompt, meaning, speech, answers, wrong_count, last_wrong_at)
      VALUES (?, ?, ?, ?, ?, 'duolingo', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mistake_key) DO UPDATE SET
        item_id = excluded.item_id,
        mode = excluded.mode,
        lesson_id = excluded.lesson_id,
        course_id = 'duolingo',
        prompt = excluded.prompt,
        meaning = excluded.meaning,
        speech = excluded.speech,
        answers = excluded.answers,
        wrong_count = MAX(wrong_count + 1, excluded.wrong_count),
        last_wrong_at = excluded.last_wrong_at`)
      .bind(user.id, key, id, mode, lessonId, prompt, meaning, speech, JSON.stringify(answers), wrongCount, lastWrongAt)
      .run();
    const row = await db.prepare('SELECT * FROM mistake_progress WHERE user_id = ? AND mistake_key = ?')
      .bind(user.id, key)
      .first();
    return dataResponse({ ok: true, record: mistakeRowToRecord(row) });
  }

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
    const lesson = await db.prepare('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .bind(user.id, lessonId)
      .first();
    return dataResponse({ ok: true, lesson: lessonRowToRecord(lesson) });
  }

  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return jsonResponse('id is required', 400);
  const table = kind === 'sentence' ? 'sentence_progress' : 'vocabulary_progress';
  const idColumn = kind === 'sentence' ? 'sentence_id' : 'vocabulary_id';

  if (payload.action === 'removeMastery') {
    await db.prepare(`INSERT INTO ${table} (user_id, ${idColumn}, lesson_id, course_id, correct_count, wrong_count, mastered, last_practiced_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET
        lesson_id = excluded.lesson_id,
        course_id = excluded.course_id,
        correct_count = 0,
        wrong_count = 0,
        mastered = 0,
        last_practiced_at = CURRENT_TIMESTAMP`)
      .bind(user.id, id, lessonId, courseId)
      .run();
    const row = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND ${idColumn} = ?`)
      .bind(user.id, id)
      .first();
    return dataResponse({ ok: true, record: progressRowToRecord(row, kind) });
  }

  const correct = Boolean(payload.correct);
  const mastered = correct && Boolean(payload.mastered);
  await db.prepare(`INSERT INTO ${table} (user_id, ${idColumn}, lesson_id, course_id, correct_count, wrong_count, mastered, last_practiced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, ${idColumn}) DO UPDATE SET
      lesson_id = excluded.lesson_id,
      course_id = excluded.course_id,
      correct_count = correct_count + ?,
      wrong_count = wrong_count + ?,
      mastered = CASE WHEN mastered = 1 OR excluded.mastered = 1 THEN 1 ELSE 0 END,
      last_practiced_at = CURRENT_TIMESTAMP`)
    .bind(user.id, id, lessonId, courseId, correct ? 1 : 0, correct ? 0 : 1, mastered ? 1 : 0, correct ? 1 : 0, correct ? 0 : 1)
    .run();
  const row = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND ${idColumn} = ?`)
    .bind(user.id, id)
    .first();
  return dataResponse({ ok: true, record: progressRowToRecord(row, kind) });
};

export default {
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/tts') return handleTts(request, context);
      if (url.pathname === '/api/login') return handleLogin(request, env);
      if (url.pathname === '/api/me') return handleMe(request, env);
      if (url.pathname === '/api/logout') return handleLogout(request, env);
      if (url.pathname === '/api/password') return handlePassword(request, env);
      if (url.pathname === '/api/admin/users') return handleAdminUsers(request, env);
      if (url.pathname === '/api/admin/duolingo') return handleAdminDuolingo(request, env);
      if (url.pathname === '/api/duolingo') return handleDuolingo(request, env);
      if (url.pathname === '/api/progress') return handleProgress(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (isResponse(error)) return error;
      return jsonResponse('Internal server error', 500);
    }
  }
};
