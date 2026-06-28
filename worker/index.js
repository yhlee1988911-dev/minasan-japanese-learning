const MAX_TEXT_LENGTH = 200;
const ROOT_PASSWORD_HASH = 'a28373767b16f998af23afbd173e12fdecc355b3cd5a6f25ec80756bf39c82e5';
const SESSION_DAYS = 30;
const MAX_DEVICES_PER_USER = 3;
const SYSTEM_COURSE_ID = 'system-beginner-50';
const USER_COURSE_LIMIT = 10;
const USER_LESSON_LIMIT = 200;
const USER_VOCABULARY_LIMIT = 500;
const SYSTEM_VOCABULARY_LIMIT = 20000;
const MAX_IMPORT_TEXT_LENGTH = 500000;
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLUMNS = 16;
const FIELD_LIMITS = {
  title: 80,
  description: 300,
  term: 120,
  reading: 120,
  meaning: 300,
  romaji: 120,
  partOfSpeech: 60,
  tags: 300
};
const IMPORT_TEMPLATE_HEADERS = ['课时序号', '课时名称', '日文', '假名', '罗马音', '释义', '词性', '标签'];
const ILLEGAL_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SPREADSHEET_FORMULA_PREFIX_PATTERN = /^(?:[=+@]|-[=+\-@A-Za-z0-9(])/;

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

const textResponse = (text, headers = {}) => new Response(text, {
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers
  }
});

const binaryResponse = (bytes, headers = {}) => new Response(bytes, {
  headers: {
    'Cache-Control': 'no-store',
    ...headers
  }
});

const encodeText = (value) => new TextEncoder().encode(value);

const concatBytes = (items) => {
  const total = items.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const item of items) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
};

const u16 = (value) => new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
const u32 = (value) => new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]);

const crcTable = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (files) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const dosTime = 0;

  for (const file of files) {
    const name = encodeText(file.name);
    const content = typeof file.content === 'string' ? encodeText(file.content) : file.content;
    const crc = crc32(content);
    const utf8Flag = 0x0800;
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(utf8Flag),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
      content
    ]);
    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(utf8Flag),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    localParts.push(localHeader);
    centralParts.push(centralHeader);
    offset += localHeader.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralStart),
    u16(0)
  ]);
  return concatBytes([...localParts, ...centralParts, end]);
};

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

const ensureCatalogRuntimeSchema = async (db) => {
  await ensureDuolingoAdminSchema(db);
  await ensureMistakeSchema(db);
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_courses_owner_active ON courses(owner_type, owner_user_id, is_active, sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_lessons_course_active_order ON lessons(course_id, is_active, order_index)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_vocabulary_course_active_lesson ON vocabulary(course_id, is_active, lesson_id, source_row)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_sentences_course_active_lesson ON sentences(course_id, is_active, lesson_id)').run();
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

  if (action === 'resetPassword') {
    const target = await db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first();
    if (!target) return jsonResponse('账户不存在', 404);
    const passwordHash = await sha256('12345678');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
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
    await db.prepare("UPDATE courses SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE owner_type = 'user' AND owner_user_id = ?").bind(userId).run();
    await db.prepare('UPDATE lessons SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE owner_user_id = ?').bind(userId).run();
    await db.prepare('UPDATE vocabulary SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE owner_user_id = ?').bind(userId).run();
    await db.prepare('UPDATE sentences SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE owner_user_id = ?').bind(userId).run();
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

const parseJsonValue = (value, fallback) => {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
};

const catalogRowsToPayload = (courseRows, lessonRows, vocabularyRows, sentenceRows) => {
  const lessonsByCourse = new Map();
  const vocabularyByLesson = new Map();
  const sentencesByLesson = new Map();

  for (const lesson of lessonRows) {
    if (!lessonsByCourse.has(lesson.course_id)) lessonsByCourse.set(lesson.course_id, []);
    lessonsByCourse.get(lesson.course_id).push(lesson);
  }
  for (const word of vocabularyRows) {
    if (!vocabularyByLesson.has(word.lesson_id)) vocabularyByLesson.set(word.lesson_id, []);
    vocabularyByLesson.get(word.lesson_id).push(word);
  }
  for (const sentence of sentenceRows) {
    if (!sentencesByLesson.has(sentence.lesson_id)) sentencesByLesson.set(sentence.lesson_id, []);
    sentencesByLesson.get(sentence.lesson_id).push(sentence);
  }

  return {
    courses: courseRows.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description || '',
      lessonIds: (lessonsByCourse.get(item.id) || []).map(lesson => lesson.id),
      ownerType: item.owner_type || 'system',
      ownerUserId: item.owner_user_id || null,
      sourceType: item.source_type || '',
      sortOrder: Number(item.sort_order || 0),
      isSystem: (item.owner_type || 'system') === 'system'
    })),
    lessons: lessonRows.map(item => ({
      id: item.id,
      courseId: item.course_id,
      order: Number(item.order_index || 0),
      title: item.title,
      description: item.description || '',
      vocabularyIds: (vocabularyByLesson.get(item.id) || []).map(word => word.id),
      sentenceIds: (sentencesByLesson.get(item.id) || []).map(sentence => sentence.id),
      ownerUserId: item.owner_user_id || null
    })),
    vocabulary: vocabularyRows.map(item => {
      const tags = parseJsonValue(item.tags, {});
      return {
        id: item.id,
        courseId: item.course_id,
        term: item.term,
        reading: item.reading,
        accents: Array.isArray(tags?.accents) ? tags.accents : [],
        accentDisplay: item.accent_display || '',
        partOfSpeech: item.part_of_speech || '未分类',
        partOfSpeechCode: item.part_of_speech_code || '',
        meanings: [item.meaning].filter(Boolean),
        sourceLesson: item.lesson_id,
        sourceLessonLabel: item.lesson_title || item.lesson_id,
        sourceSequence: Number(item.source_row || 0),
        sourceRow: Number(item.source_row || 0),
        romaji: item.romaji || '',
        ownerUserId: item.owner_user_id || null
      };
    }),
    sentences: sentenceRows.map(item => ({
      id: item.id,
      courseId: item.course_id,
      lessonId: item.lesson_id,
      text: item.text,
      reading: item.reading,
      meaning: item.meaning,
      clozeText: item.cloze_text || '＿＿。',
      answers: parseJsonValue(item.answers, []),
      vocabularyIds: [],
      source: item.owner_user_id ? 'verified' : 'generated'
    }))
  };
};

const listCatalog = async (db, user) => {
  await ensureCatalogRuntimeSchema(db);
  const courses = await db.prepare(`SELECT *
    FROM courses
    WHERE is_active = 1 AND (owner_type = 'system' OR owner_user_id = ?)
    ORDER BY CASE WHEN owner_type = 'system' THEN 0 ELSE 1 END, sort_order ASC, created_at ASC, title ASC`)
    .bind(user.id)
    .all();
  const lessons = await db.prepare(`SELECT lessons.*
    FROM lessons
    JOIN courses ON courses.id = lessons.course_id
    WHERE lessons.is_active = 1
      AND courses.is_active = 1
      AND (courses.owner_type = 'system' OR courses.owner_user_id = ?)
    ORDER BY CASE WHEN courses.owner_type = 'system' THEN 0 ELSE 1 END, courses.sort_order ASC, lessons.order_index ASC, lessons.title ASC`)
    .bind(user.id)
    .all();
  const vocabulary = await db.prepare(`SELECT vocabulary.*, lessons.title AS lesson_title, lessons.order_index
    FROM vocabulary
    JOIN lessons ON lessons.id = vocabulary.lesson_id
    JOIN courses ON courses.id = vocabulary.course_id
    WHERE vocabulary.is_active = 1
      AND lessons.is_active = 1
      AND courses.is_active = 1
      AND (courses.owner_type = 'system' OR courses.owner_user_id = ?)
    ORDER BY CASE WHEN courses.owner_type = 'system' THEN 0 ELSE 1 END, courses.sort_order ASC, lessons.order_index ASC, vocabulary.source_row ASC, vocabulary.term ASC`)
    .bind(user.id)
    .all();
  const sentences = await db.prepare(`SELECT sentences.*
    FROM sentences
    JOIN lessons ON lessons.id = sentences.lesson_id
    JOIN courses ON courses.id = sentences.course_id
    WHERE sentences.is_active = 1
      AND lessons.is_active = 1
      AND courses.is_active = 1
      AND (courses.owner_type = 'system' OR courses.owner_user_id = ?)
    ORDER BY CASE WHEN courses.owner_type = 'system' THEN 0 ELSE 1 END, courses.sort_order ASC, lessons.order_index ASC, sentences.id ASC`)
    .bind(user.id)
    .all();

  return catalogRowsToPayload(courses.results || [], lessons.results || [], vocabulary.results || [], sentences.results || []);
};

const isRootAdmin = (user) => user?.username === 'root';

const assertOwnedCourse = async (db, user, courseId) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND is_active = 1')
    .bind(courseId)
    .first();
  if (!course) throw jsonResponse('课件不存在或不可编辑', 404);
  if ((course.owner_type || 'system') === 'system') {
    if (!isRootAdmin(user)) throw jsonResponse('公共词库只有管理员可以维护', 403);
    return course;
  }
  if (course.owner_user_id !== user.id) throw jsonResponse('只能操作自己创建的课件', 403);
  return course;
};

const assertOwnedLesson = async (db, user, lessonId) => {
  const lesson = await db.prepare(`SELECT lessons.*
      , courses.owner_type AS course_owner_type
      , courses.owner_user_id AS course_owner_user_id
    FROM lessons
    JOIN courses ON courses.id = lessons.course_id
    WHERE lessons.id = ?
      AND lessons.is_active = 1
      AND courses.is_active = 1`)
    .bind(lessonId)
    .first();
  if (!lesson) throw jsonResponse('课时不存在或不可编辑', 404);
  if ((lesson.course_owner_type || 'system') === 'system') {
    if (!isRootAdmin(user)) throw jsonResponse('公共词库只有管理员可以维护', 403);
    return lesson;
  }
  if (lesson.course_owner_user_id !== user.id) throw jsonResponse('只能操作自己课件中的课时', 403);
  return lesson;
};

const assertEditableWord = async (db, user, wordId) => {
  const existing = await db.prepare(`SELECT vocabulary.*
      , courses.owner_type AS course_owner_type
      , courses.owner_user_id AS course_owner_user_id
    FROM vocabulary
    JOIN courses ON courses.id = vocabulary.course_id
    WHERE vocabulary.id = ?
      AND vocabulary.is_active = 1
      AND courses.is_active = 1`)
    .bind(wordId)
    .first();
  if (!existing) throw jsonResponse('词条不存在或不可编辑', 404);
  if ((existing.course_owner_type || 'system') === 'system') {
    if (!isRootAdmin(user)) throw jsonResponse('公共词库只有管理员可以维护', 403);
    return existing;
  }
  if (existing.course_owner_user_id !== user.id) throw jsonResponse('词条不存在或不可编辑', 404);
  return existing;
};

const vocabularyLimitForCourse = (course) => (course?.owner_type || course?.course_owner_type || 'system') === 'system'
  ? SYSTEM_VOCABULARY_LIMIT
  : USER_VOCABULARY_LIMIT;
const ownerUserIdForCourse = (course, user) => (course?.owner_type || course?.course_owner_type || 'system') === 'system' ? null : user.id;

const cleanUserText = (value) => String(value ?? '').replace(/\uFEFF/g, '').trim();
const normalizeTitle = (value, fallback = '') => cleanUserText(cleanUserText(value) || fallback);
const normalizeDescription = (value) => cleanUserText(value);
const validateUserText = (label, value, maxLength, options = {}) => {
  const text = cleanUserText(value);
  if (options.required && !text) return `${label}不能为空`;
  if (!text) return '';
  if (ILLEGAL_CONTROL_CHARACTER_PATTERN.test(text)) return `${label}包含非法控制字符`;
  if (text.length > maxLength) return `${label}不能超过 ${maxLength} 个字符`;
  if (!options.allowFormulaPrefix && SPREADSHEET_FORMULA_PREFIX_PATTERN.test(text)) {
    return `${label}不能以电子表格公式符号开头`;
  }
  return '';
};
const firstValidationError = (...errors) => errors.find(Boolean) || '';
const normalizeLessonOrder = (value) => {
  const matched = String(value || '').match(/\d+/)?.[0];
  const order = Number(matched || 0);
  return Number.isInteger(order) && order >= 1 && order <= USER_LESSON_LIMIT ? order : 0;
};

const createCatalogCourse = async (db, user, payload) => {
  const title = normalizeTitle(payload.title);
  const fieldError = firstValidationError(
    validateUserText('课件名称', title, FIELD_LIMITS.title, { required: true }),
    validateUserText('说明', payload.description, FIELD_LIMITS.description)
  );
  if (fieldError) return jsonResponse(fieldError, 400);
  const ownerType = payload.ownerType === 'system' && isRootAdmin(user) ? 'system' : 'user';
  const ownerUserId = ownerType === 'system' ? null : user.id;
  if (ownerType === 'user') {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM courses WHERE owner_type = 'user' AND owner_user_id = ? AND is_active = 1")
      .bind(user.id)
      .first();
    if (Number(count?.count || 0) >= USER_COURSE_LIMIT) return jsonResponse(`每位用户最多创建 ${USER_COURSE_LIMIT} 个课件`, 400);
  }
  const maxSort = ownerType === 'system'
    ? await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM courses WHERE owner_type = 'system'").first()
    : await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM courses WHERE owner_type = 'user' AND owner_user_id = ?").bind(user.id).first();
  const id = `course-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO courses
    (id, title, description, source, updated_at, owner_type, owner_user_id, source_type, sort_order, is_active, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`)
    .bind(id, title, normalizeDescription(payload.description), ownerType, ownerType, ownerUserId, ownerType === 'system' ? 'open' : 'manual', Number(maxSort?.max_sort || 0) + 1)
    .run();
  return dataResponse(await listCatalog(db, user));
};

const updateCatalogCourse = async (db, user, payload) => {
  const courseId = String(payload.courseId || '').trim();
  if (!courseId) return jsonResponse('缺少课件 ID', 400);
  const course = await assertOwnedCourse(db, user, courseId);
  const title = normalizeTitle(payload.title);
  const fieldError = firstValidationError(
    validateUserText('课件名称', title, FIELD_LIMITS.title, { required: true }),
    validateUserText('说明', payload.description ?? course.description, FIELD_LIMITS.description)
  );
  if (fieldError) return jsonResponse(fieldError, 400);
  await db.prepare('UPDATE courses SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(title, normalizeDescription(payload.description ?? course.description), courseId)
    .run();
  return dataResponse(await listCatalog(db, user));
};

const deleteCatalogCourse = async (db, user, payload) => {
  const courseId = String(payload.courseId || '').trim();
  if (!courseId) return jsonResponse('缺少课件 ID', 400);
  const course = await assertOwnedCourse(db, user, courseId);
  if ((course.owner_type || 'system') === 'system') return jsonResponse('公共词库不能整套删除，请删除或更新具体课时和词条', 400);
  await db.prepare('UPDATE courses SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(courseId).run();
  await db.prepare('UPDATE lessons SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?').bind(courseId).run();
  await db.prepare('UPDATE vocabulary SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?').bind(courseId).run();
  await db.prepare('UPDATE sentences SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?').bind(courseId).run();
  await db.prepare('DELETE FROM vocabulary_progress WHERE user_id = ? AND course_id = ?').bind(user.id, courseId).run();
  await db.prepare('DELETE FROM sentence_progress WHERE user_id = ? AND course_id = ?').bind(user.id, courseId).run();
  await db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND course_id = ?').bind(user.id, courseId).run();
  await db.prepare('DELETE FROM mistake_progress WHERE user_id = ? AND course_id = ?').bind(user.id, courseId).run();
  return dataResponse(await listCatalog(db, user));
};

const parseShareTargets = (value) => {
  const source = Array.isArray(value) ? value.join('；') : String(value || '');
  return [...new Set(source.split(/[；;,\s，、]+/).map(item => item.trim()).filter(Boolean))];
};

const uniqueSharedCourseTitle = async (db, userId, title) => {
  const rows = await db.prepare("SELECT title FROM courses WHERE owner_type = 'user' AND owner_user_id = ? AND is_active = 1")
    .bind(userId)
    .all();
  const titles = new Set((rows.results || []).map(row => String(row.title || '')));
  if (!titles.has(title)) return title;
  const base = `${title} - 分享`;
  if (!titles.has(base)) return base;
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${base} ${index}`;
    if (!titles.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
};

const copyCourseForUser = async (db, sourceCourse, targetUser) => {
  const [activeCourseCount, maxSort, lessonRows, vocabularyRows, sentenceRows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM courses WHERE owner_type = 'user' AND owner_user_id = ? AND is_active = 1").bind(targetUser.id).first(),
    db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM courses WHERE owner_type = 'user' AND owner_user_id = ?").bind(targetUser.id).first(),
    db.prepare('SELECT * FROM lessons WHERE course_id = ? AND is_active = 1 ORDER BY order_index ASC, created_at ASC, id ASC').bind(sourceCourse.id).all(),
    db.prepare('SELECT * FROM vocabulary WHERE course_id = ? AND is_active = 1 ORDER BY lesson_id ASC, source_row ASC, id ASC').bind(sourceCourse.id).all(),
    db.prepare('SELECT * FROM sentences WHERE course_id = ? AND is_active = 1 ORDER BY lesson_id ASC, id ASC').bind(sourceCourse.id).all()
  ]);
  const lessons = lessonRows.results || [];
  const vocabulary = vocabularyRows.results || [];
  const sentences = sentenceRows.results || [];
  if (Number(activeCourseCount?.count || 0) >= USER_COURSE_LIMIT) {
    return { ok: false, reason: `${targetUser.username} 的课件已达 ${USER_COURSE_LIMIT} 个上限` };
  }
  if (!lessons.length) return { ok: false, reason: `${sourceCourse.title} 没有可分享课时` };
  if (vocabulary.length > USER_VOCABULARY_LIMIT) {
    return { ok: false, reason: `${sourceCourse.title} 有 ${vocabulary.length} 个词，超过用户课件 ${USER_VOCABULARY_LIMIT} 个词上限` };
  }

  const title = await uniqueSharedCourseTitle(db, targetUser.id, sourceCourse.title);
  const courseId = `course-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO courses
    (id, title, description, source, updated_at, owner_type, owner_user_id, source_type, sort_order, is_active, created_at)
    VALUES (?, ?, ?, 'shared', CURRENT_TIMESTAMP, 'user', ?, 'shared', ?, 1, CURRENT_TIMESTAMP)`)
    .bind(courseId, title, sourceCourse.description || '', targetUser.id, Number(maxSort?.max_sort || 0) + 1)
    .run();

  const lessonMap = new Map();
  for (const lesson of lessons) {
    const lessonId = `lesson-${crypto.randomUUID()}`;
    lessonMap.set(lesson.id, lessonId);
    await db.prepare(`INSERT INTO lessons
      (id, course_id, title, order_index, description, owner_user_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(lessonId, courseId, lesson.title, Number(lesson.order_index || 0), lesson.description || '', targetUser.id)
      .run();
  }

  for (const word of vocabulary) {
    const lessonId = lessonMap.get(word.lesson_id);
    if (!lessonId) continue;
    await db.prepare(`INSERT INTO vocabulary
      (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at, is_active, deleted_at, accent_display, part_of_speech_code, owner_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(
        `word-${crypto.randomUUID()}`,
        courseId,
        lessonId,
        word.term,
        word.reading,
        word.meaning,
        word.romaji || '',
        word.part_of_speech || '',
        word.tags || '[]',
        Number(word.source_row || 0),
        word.accent_display || '',
        word.part_of_speech_code || '',
        targetUser.id
      )
      .run();
  }

  for (const sentence of sentences) {
    const lessonId = lessonMap.get(sentence.lesson_id);
    if (!lessonId) continue;
    await db.prepare(`INSERT INTO sentences
      (id, course_id, lesson_id, text, reading, meaning, cloze_text, answers, updated_at, owner_user_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, CURRENT_TIMESTAMP)`)
      .bind(
        `sentence-${crypto.randomUUID()}`,
        courseId,
        lessonId,
        sentence.text,
        sentence.reading,
        sentence.meaning,
        sentence.cloze_text || '',
        sentence.answers || '[]',
        targetUser.id
      )
      .run();
  }

  return {
    ok: true,
    userId: targetUser.id,
    username: targetUser.username,
    courseId,
    title,
    lessons: lessons.length,
    vocabulary: vocabulary.length,
    sentences: sentences.length
  };
};

const shareCatalogCourse = async (db, user, payload) => {
  if (!isRootAdmin(user)) return jsonResponse('只有 root 可以分享课件', 403);
  const courseId = String(payload.courseId || '').trim();
  if (!courseId) return jsonResponse('缺少课件 ID', 400);
  const course = await assertOwnedCourse(db, user, courseId);
  if ((course.owner_type || 'system') === 'system') return jsonResponse('公共词库不需要分享课件，请分享 root 的自定义课件', 400);
  const targets = parseShareTargets(payload.targetUserIds || payload.targets || payload.userIds);
  if (!targets.length) return jsonResponse('请输入目标用户 ID', 400);

  const shared = [];
  const skipped = [];
  for (const target of targets) {
    const targetUser = await db.prepare('SELECT id, username FROM users WHERE id = ? OR username = ?')
      .bind(target, target)
      .first();
    if (!targetUser) {
      skipped.push({ target, reason: '用户不存在' });
      continue;
    }
    if (targetUser.id === user.id) {
      skipped.push({ target, reason: '不能分享给自己' });
      continue;
    }
    const result = await copyCourseForUser(db, course, targetUser);
    if (result.ok) shared.push(result);
    else skipped.push({ target, userId: targetUser.id, username: targetUser.username, reason: result.reason });
  }

  if (!shared.length) {
    return jsonResponse(skipped.map(item => `${item.target || item.username}：${item.reason}`).join('；') || '没有成功分享的用户', 400);
  }
  return dataResponse({ ok: true, shared, skipped, catalog: await listCatalog(db, user) });
};

const createCatalogLesson = async (db, user, payload) => {
  const courseId = String(payload.courseId || '').trim();
  if (!courseId) return jsonResponse('缺少课件 ID', 400);
  const course = await assertOwnedCourse(db, user, courseId);
  const order = normalizeLessonOrder(payload.order || payload.lessonOrder);
  if (!order) return jsonResponse(`课时需要在 1-${USER_LESSON_LIMIT} 之间`, 400);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM lessons WHERE course_id = ? AND is_active = 1').bind(courseId).first();
  if (Number(count?.count || 0) >= USER_LESSON_LIMIT) return jsonResponse(`每个课件最多 ${USER_LESSON_LIMIT} 个课时`, 400);
  const duplicate = await db.prepare('SELECT id FROM lessons WHERE course_id = ? AND order_index = ? AND is_active = 1').bind(courseId, order).first();
  if (duplicate) return jsonResponse('该课时已经存在', 409);
  const title = normalizeTitle(payload.title, `第${order}课`);
  const fieldError = firstValidationError(
    validateUserText('课时名称', title, FIELD_LIMITS.title, { required: true }),
    validateUserText('课时说明', payload.description, FIELD_LIMITS.description)
  );
  if (fieldError) return jsonResponse(fieldError, 400);
  const id = `lesson-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO lessons
    (id, course_id, title, order_index, description, owner_user_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .bind(id, courseId, title, order, normalizeDescription(payload.description), ownerUserIdForCourse(course, user))
    .run();
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(courseId).run();
  return dataResponse(await listCatalog(db, user));
};

const updateCatalogLesson = async (db, user, payload) => {
  const lessonId = String(payload.lessonId || '').trim();
  if (!lessonId) return jsonResponse('缺少课时 ID', 400);
  const lesson = await assertOwnedLesson(db, user, lessonId);
  const title = normalizeTitle(payload.title);
  const fieldError = firstValidationError(
    validateUserText('课时名称', title, FIELD_LIMITS.title, { required: true }),
    validateUserText('课时说明', payload.description, FIELD_LIMITS.description)
  );
  if (fieldError) return jsonResponse(fieldError, 400);
  await db.prepare('UPDATE lessons SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(title, normalizeDescription(payload.description), lessonId)
    .run();
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(lesson.course_id).run();
  return dataResponse(await listCatalog(db, user));
};

const deleteCatalogLesson = async (db, user, payload) => {
  const lessonId = String(payload.lessonId || '').trim();
  if (!lessonId) return jsonResponse('缺少课时 ID', 400);
  const lesson = await assertOwnedLesson(db, user, lessonId);
  await db.prepare('UPDATE lessons SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(lessonId).run();
  await db.prepare('UPDATE vocabulary SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE lesson_id = ?').bind(lessonId).run();
  await db.prepare('UPDATE sentences SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE lesson_id = ?').bind(lessonId).run();
  const isSystemCourse = (lesson.course_owner_type || 'system') === 'system';
  if (isSystemCourse) {
    await db.prepare('DELETE FROM vocabulary_progress WHERE lesson_id = ?').bind(lessonId).run();
    await db.prepare('DELETE FROM sentence_progress WHERE lesson_id = ?').bind(lessonId).run();
    await db.prepare('DELETE FROM lesson_progress WHERE lesson_id = ?').bind(lessonId).run();
    await db.prepare('DELETE FROM mistake_progress WHERE lesson_id = ?').bind(lessonId).run();
  } else {
    await db.prepare('DELETE FROM vocabulary_progress WHERE user_id = ? AND lesson_id = ?').bind(user.id, lessonId).run();
    await db.prepare('DELETE FROM sentence_progress WHERE user_id = ? AND lesson_id = ?').bind(user.id, lessonId).run();
    await db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').bind(user.id, lessonId).run();
    await db.prepare('DELETE FROM mistake_progress WHERE user_id = ? AND lesson_id = ?').bind(user.id, lessonId).run();
  }
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(lesson.course_id).run();
  return dataResponse(await listCatalog(db, user));
};

const normalizeWordPayload = (payload) => ({
  term: cleanUserText(payload.term),
  reading: cleanUserText(payload.reading),
  meaning: cleanUserText(payload.meaning),
  romaji: cleanUserText(payload.romaji),
  partOfSpeech: cleanUserText(payload.partOfSpeech) || '未分类',
  tags: cleanUserText(payload.tags)
});

const validateWordFieldErrors = (word) => [
    validateUserText('日文', word.term, FIELD_LIMITS.term, { required: true }),
    validateUserText('假名', word.reading, FIELD_LIMITS.reading, { required: true }),
    validateUserText('释义', word.meaning, FIELD_LIMITS.meaning, { required: true }),
    validateUserText('罗马音', word.romaji, FIELD_LIMITS.romaji),
    validateUserText('词性', word.partOfSpeech, FIELD_LIMITS.partOfSpeech),
    validateUserText('标签', word.tags, FIELD_LIMITS.tags)
  ].filter(Boolean);

const validateWordFields = (word) => validateWordFieldErrors(word)[0] || '';

const createCatalogWord = async (db, user, payload) => {
  const lessonId = String(payload.lessonId || '').trim();
  if (!lessonId) return jsonResponse('缺少课时 ID', 400);
  const lesson = await assertOwnedLesson(db, user, lessonId);
  const course = await db.prepare('SELECT owner_type FROM courses WHERE id = ? AND is_active = 1').bind(lesson.course_id).first();
  const word = normalizeWordPayload(payload);
  const error = validateWordFields(word);
  if (error) return jsonResponse(error, 400);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM vocabulary WHERE course_id = ? AND is_active = 1').bind(lesson.course_id).first();
  const vocabularyLimit = vocabularyLimitForCourse(course || lesson);
  if (Number(count?.count || 0) >= vocabularyLimit) return jsonResponse(`每个课件最多 ${vocabularyLimit} 个词条`, 400);
  const duplicate = await db.prepare('SELECT id FROM vocabulary WHERE course_id = ? AND lesson_id = ? AND term = ? AND reading = ? AND is_active = 1')
    .bind(lesson.course_id, lessonId, word.term, word.reading)
    .first();
  if (duplicate) return jsonResponse('该课时已有相同日文和假名的词条', 409);
  const maxRow = await db.prepare('SELECT COALESCE(MAX(source_row), 0) AS max_row FROM vocabulary WHERE course_id = ?').bind(lesson.course_id).first();
  const id = `word-${crypto.randomUUID()}`;
  await db.prepare(`INSERT INTO vocabulary
    (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at, is_active, deleted_at, accent_display, part_of_speech_code, owner_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, NULL, '', '', ?, CURRENT_TIMESTAMP)`)
    .bind(id, lesson.course_id, lessonId, word.term, word.reading, word.meaning, word.romaji, word.partOfSpeech, JSON.stringify({ tags: word.tags }), Number(maxRow?.max_row || 0) + 1, ownerUserIdForCourse(course || lesson, user))
    .run();
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(lesson.course_id).run();
  return dataResponse(await listCatalog(db, user));
};

const updateCatalogWord = async (db, user, payload) => {
  const wordId = String(payload.wordId || payload.id || '').trim();
  if (!wordId) return jsonResponse('缺少词汇 ID', 400);
  const existing = await assertEditableWord(db, user, wordId);
  const lessonId = String(payload.lessonId || existing.lesson_id).trim();
  const lesson = await assertOwnedLesson(db, user, lessonId);
  if (lesson.course_id !== existing.course_id) return jsonResponse('词条不能移动到其他课件', 400);
  const word = normalizeWordPayload(payload);
  const error = validateWordFields(word);
  if (error) return jsonResponse(error, 400);
  const duplicate = await db.prepare('SELECT id FROM vocabulary WHERE course_id = ? AND lesson_id = ? AND term = ? AND reading = ? AND is_active = 1 AND id != ?')
    .bind(existing.course_id, lessonId, word.term, word.reading, wordId)
    .first();
  if (duplicate) return jsonResponse('该课时已有相同日文和假名的词条', 409);
  await db.prepare(`UPDATE vocabulary
    SET lesson_id = ?, term = ?, reading = ?, meaning = ?, romaji = ?, part_of_speech = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`)
    .bind(lessonId, word.term, word.reading, word.meaning, word.romaji, word.partOfSpeech, JSON.stringify({ tags: word.tags }), wordId)
    .run();
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existing.course_id).run();
  return dataResponse(await listCatalog(db, user));
};

const deleteCatalogWord = async (db, user, payload) => {
  const wordId = String(payload.wordId || payload.id || '').trim();
  if (!wordId) return jsonResponse('缺少词汇 ID', 400);
  const existing = await assertEditableWord(db, user, wordId);
  await db.prepare('UPDATE vocabulary SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(wordId).run();
  const isSystemCourse = (existing.course_owner_type || 'system') === 'system';
  if (isSystemCourse) {
    await db.prepare('DELETE FROM vocabulary_progress WHERE vocabulary_id = ?').bind(wordId).run();
    await db.prepare('DELETE FROM mistake_progress WHERE item_id = ?').bind(wordId).run();
  } else {
    await db.prepare('DELETE FROM vocabulary_progress WHERE user_id = ? AND vocabulary_id = ?').bind(user.id, wordId).run();
    await db.prepare('DELETE FROM mistake_progress WHERE user_id = ? AND item_id = ?').bind(user.id, wordId).run();
  }
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existing.course_id).run();
  return dataResponse(await listCatalog(db, user));
};

const splitDelimitedLine = (line) => {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

const normalizeHeaderName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\s_\-（）()【】\[\]：:]/g, '');

const isKanaText = (value) => /^[\u3040-\u309f\u30a0-\u30ffー・\s]+$/.test(String(value || '').trim());
const hasKanaText = (value) => /[\u3040-\u30ffー]/.test(String(value || ''));
const hasKanjiText = (value) => /[\u3400-\u9fff]/.test(String(value || ''));
const isRomajiText = (value) => /^[a-zA-ZāīūēōĀĪŪĒŌ\s.'-]+$/.test(String(value || '').trim());
const isLikelyPos = (value) => /^(名词|名詞|动词|動詞|形容词|形容詞|副词|副詞|助词|助詞|接续词|接續詞|感叹词|感嘆詞|连体词|連体詞|代词|代詞|数词|数詞|接尾|接头|未分类|noun|verb|adj|adjective|adverb|particle)$/i.test(String(value || '').trim());

const isCompactNoHeaderVocabularyTable = (rows, hasHeader) => {
  if (hasHeader) return false;
  const samples = rows.slice(0, 12).filter(row => row.some(cell => String(cell || '').trim()));
  if (!samples.length) return false;
  const fourColumnRows = samples.every(row => row.length === 4);
  if (fourColumnRows) {
    return samples.every(row => {
      const [term, reading, romaji, meaning] = row.map(cell => String(cell || '').trim());
      return term && reading && romaji && meaning && isRomajiText(romaji);
    });
  }
  const firstFourColumnsAreVocabulary = samples.every(row => {
    const [term, reading, romaji, meaning] = row.map(cell => String(cell || '').trim());
    return term && reading && romaji && meaning && isRomajiText(romaji);
  });
  if (firstFourColumnsAreVocabulary) return true;
  if (samples.some(row => row.length < 4 || row.length > 6)) return false;
  return samples.every(row => {
    const [term, reading, romaji, meaning] = row.map(cell => String(cell || '').trim());
    return term
      && reading
      && romaji
      && meaning
      && (hasKanaText(term) || hasKanjiText(term))
      && isKanaText(reading)
      && isRomajiText(romaji)
      && hasKanjiText(meaning)
      && !isKanaText(meaning);
  });
};

const guessCatalogImportIndexes = (rows, hasHeader, aliases, fallbackIndexes) => {
  const headers = hasHeader ? rows[0].map(normalizeHeaderName) : [];
  const dataRows = rows.slice(hasHeader ? 1 : 0, hasHeader ? 13 : 12);
  const maxColumns = Math.max(...rows.map(row => row.length), 0);
  const used = new Set();
  const byHeader = (key) => {
    if (!hasHeader) return -1;
    return headers.findIndex(cell => aliases[key].some(alias => cell === normalizeHeaderName(alias) || cell.includes(normalizeHeaderName(alias))));
  };
  const sampleValues = (columnIndex) => dataRows.map(row => String(row[columnIndex] || '').trim()).filter(Boolean);
  const scoreColumn = (key, columnIndex) => {
    const values = sampleValues(columnIndex);
    if (!values.length) return 0;
    const count = (predicate) => values.filter(predicate).length;
    if (key === 'lessonOrder') return count(value => normalizeLessonOrder(value) > 0) * 4 - count(value => hasKanaText(value) || hasKanjiText(value)) * 2;
    if (key === 'lessonTitle') return count(value => /课|課|lesson|unit|章|节|節|第\d+/i.test(value)) * 6 - count(value => isKanaText(value) || value.length > 40) * 2;
    if (key === 'term') return count(value => hasKanjiText(value) || hasKanaText(value)) * 4 + count(value => /[\u30a0-\u30ff]/.test(value)) - count(value => isLikelyPos(value)) * 3;
    if (key === 'reading') return count(isKanaText) * 5 + count(hasKanaText) * 2 - count(hasKanjiText) * 3;
    if (key === 'romaji') return count(value => isRomajiText(value) && !isLikelyPos(value)) * 5 - count(value => hasKanaText(value) || hasKanjiText(value)) * 3;
    if (key === 'meaning') return count(hasKanjiText) * 3 + count(value => value.length > 8) * 2 - count(isKanaText) * 3 - count(isLikelyPos) * 2;
    if (key === 'partOfSpeech') return count(isLikelyPos) * 6 + count(value => value.length <= 8) - count(value => value.length > 20) * 2;
    if (key === 'tags') return count(value => /[,，;；#、]/.test(value)) * 3 + count(value => value.length <= 60);
    return 0;
  };
  const assign = (key, minimumScore = 1) => {
    const headerIndex = byHeader(key);
    if (headerIndex >= 0 && !used.has(headerIndex)) {
      used.add(headerIndex);
      return headerIndex;
    }
    let bestIndex = -1;
    let bestScore = minimumScore - 1;
    for (let index = 0; index < maxColumns; index += 1) {
      if (used.has(index)) continue;
      const score = scoreColumn(key, index);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) used.add(bestIndex);
    return bestIndex;
  };
  return {
    lessonOrder: assign('lessonOrder', 4),
    lessonTitle: assign('lessonTitle', 5),
    term: assign('term', 4),
    reading: assign('reading', 5),
    romaji: assign('romaji', 5),
    meaning: assign('meaning', 4),
    partOfSpeech: assign('partOfSpeech', 5),
    tags: assign('tags', 4),
    fallback: fallbackIndexes
  };
};

const parseCatalogImportRows = (text) => {
  const sourceText = String(text || '').replace(/^\uFEFF/, '');
  if (sourceText.length > MAX_IMPORT_TEXT_LENGTH) throw jsonResponse('导入内容过大，请分批上传', 400);
  if (ILLEGAL_CONTROL_CHARACTER_PATTERN.test(sourceText)) throw jsonResponse('导入内容包含非法控制字符', 400);
  const rawRows = sourceText.split(/\r?\n/).filter(line => line.trim());
  if (rawRows.length > MAX_IMPORT_ROWS) throw jsonResponse(`一次最多导入 ${MAX_IMPORT_ROWS} 行，请分批上传`, 400);
  if (!rawRows.length) return [];
  const matrix = rawRows.map(splitDelimitedLine);
  const tooWideRowIndex = matrix.findIndex(row => row.length > MAX_IMPORT_COLUMNS);
  if (tooWideRowIndex >= 0) throw jsonResponse(`第 ${tooWideRowIndex + 1} 行列数过多，请控制在 ${MAX_IMPORT_COLUMNS} 列以内`, 400);
  const first = matrix[0].map(normalizeHeaderName);
  const aliases = {
    lessonOrder: ['课时序号', '课程序号', '课时', '課時', '课', '課', 'lesson', 'lessonorder', 'order', 'unit', 'no', '编号'],
    lessonTitle: ['课时名称', '課時名稱', '课程名称', '课名', '課名', 'lesson_title', 'lessontitle', 'lessonname', 'title', 'unitname'],
    term: ['日文', '日语', '日語', '汉字', '漢字', '词汇', '詞彙', '单词', '單詞', '原文', '表记', '表記', 'term', 'word', 'japanese'],
    reading: ['假名', '平假名', '片假名', '读音', '讀音', '发音', '發音', '読み', '読', 'reading', 'kana', 'furigana'],
    romaji: ['罗马音', '羅馬音', '罗马字', '羅馬字', '注音', 'romaji', 'romanji', 'romanization'],
    meaning: ['释义', '釋義', '中文', '中文释义', '中文釋義', '意思', '含义', '翻译', '翻譯', 'meaning', 'translation', 'chinese'],
    partOfSpeech: ['词性', '詞性', '品词', '品詞', 'partofspeech', 'pos', 'type'],
    tags: ['标签', '標籤', '分类', '分類', '备注', '備註', 'note', 'notes', 'tag', 'tags']
  };
  const hasHeader = first.some(cell => Object.values(aliases).some(names => names.some(alias => cell === normalizeHeaderName(alias) || cell.includes(normalizeHeaderName(alias)))));
  const indexFor = (key, fallback) => {
    const index = first.findIndex(cell => aliases[key].some(alias => cell === normalizeHeaderName(alias) || cell.includes(normalizeHeaderName(alias))));
    if (index >= 0) return index;
    return hasHeader ? -1 : fallback;
  };
  const firstCells = matrix[0];
  const compactNoHeaderVocabularyTable = isCompactNoHeaderVocabularyTable(matrix, hasHeader);
  if (compactNoHeaderVocabularyTable) {
    const parsedRows = matrix.map((cells, offset) => ({
      rowNumber: offset + 1,
      lessonOrder: 0,
      lessonTitle: '',
      term: cleanUserText(cells[0]),
      reading: cleanUserText(cells[1]),
      romaji: cleanUserText(cells[2]),
      meaning: cleanUserText(cells[3]),
      partOfSpeech: cleanUserText(cells[4]) || '未分类',
      tags: cleanUserText(cells[5])
    }));
    parsedRows.mapping = {
      lessonOrder: { label: '课时序号', column: null },
      lessonTitle: { label: '课时名称', column: null },
      term: { label: '日文', column: 1 },
      reading: { label: '假名', column: 2 },
      romaji: { label: '罗马音', column: 3 },
      meaning: { label: '释义', column: 4 },
      partOfSpeech: { label: '词性', column: 5 },
      tags: { label: '标签', column: 6 }
    };
    return parsedRows;
  }
  const noHeaderOmitsLessonColumns = !hasHeader
    && (normalizeLessonOrder(firstCells[0]) === 0
      && String(firstCells[0] || '').trim()
      && String(firstCells[1] || '').trim());
  const fallbackIndexes = noHeaderOmitsLessonColumns ? {
    lessonOrder: -1,
    lessonTitle: -1,
    term: 0,
    reading: 1,
    romaji: 2,
    meaning: 3,
    partOfSpeech: 4,
    tags: 5
  } : {
    lessonOrder: hasHeader ? indexFor('lessonOrder', 0) : 0,
    lessonTitle: hasHeader ? indexFor('lessonTitle', 1) : 1,
    term: hasHeader ? indexFor('term', 2) : 2,
    reading: hasHeader ? indexFor('reading', 3) : 3,
    romaji: hasHeader ? indexFor('romaji', 4) : 4,
    meaning: hasHeader ? indexFor('meaning', 5) : 5,
    partOfSpeech: hasHeader ? indexFor('partOfSpeech', 6) : 6,
    tags: hasHeader ? indexFor('tags', 7) : 7
  };
  const guessedIndexes = compactNoHeaderVocabularyTable ? fallbackIndexes : guessCatalogImportIndexes(matrix, hasHeader, aliases, fallbackIndexes);
  const indexes = Object.fromEntries(Object.entries(fallbackIndexes).map(([key, fallback]) => [
    key,
    guessedIndexes[key] >= 0 ? guessedIndexes[key] : fallback
  ]));
  const cellAt = (cells, index) => index >= 0 ? cells[index] : '';

  const mappingLabels = {
    lessonOrder: '课时序号',
    lessonTitle: '课时名称',
    term: '日文',
    reading: '假名',
    romaji: '罗马音',
    meaning: '释义',
    partOfSpeech: '词性',
    tags: '标签'
  };
  const parsedRows = matrix.slice(hasHeader ? 1 : 0).map((cells, offset) => {
    return {
      rowNumber: offset + (hasHeader ? 2 : 1),
      lessonOrder: normalizeLessonOrder(cellAt(cells, indexes.lessonOrder)),
      lessonTitle: normalizeTitle(cellAt(cells, indexes.lessonTitle)),
      term: cleanUserText(cellAt(cells, indexes.term)),
      reading: cleanUserText(cellAt(cells, indexes.reading)),
      romaji: cleanUserText(cellAt(cells, indexes.romaji)),
      meaning: cleanUserText(cellAt(cells, indexes.meaning)),
      partOfSpeech: cleanUserText(cellAt(cells, indexes.partOfSpeech)) || '未分类',
      tags: cleanUserText(cellAt(cells, indexes.tags))
    };
  });
  parsedRows.mapping = Object.fromEntries(Object.entries(mappingLabels).map(([key, label]) => [
    key,
    { label, column: indexes[key] >= 0 ? indexes[key] + 1 : null }
  ]));
  return parsedRows;
};

const buildCatalogImportPreview = async (db, user, payload) => {
  const courseId = String(payload.courseId || '').trim();
  if (!courseId) throw jsonResponse('缺少课件 ID', 400);
  const course = await assertOwnedCourse(db, user, courseId);
  const rows = parseCatalogImportRows(payload.text);
  const lessons = await db.prepare('SELECT id, title, order_index FROM lessons WHERE course_id = ? AND is_active = 1').bind(courseId).all();
  const lessonRows = lessons.results || [];
  const lessonByOrder = new Map(lessonRows.map(item => [Number(item.order_index), item]));
  const fallbackLessonId = String(payload.lessonId || payload.selectedLessonId || payload.fallbackLessonId || '').trim();
  const fallbackLesson = lessonRows.find(item => item.id === fallbackLessonId)
    || lessonRows.sort((a, b) => Number(a.order_index) - Number(b.order_index))[0]
    || { id: '', title: '第1课', order_index: 1 };
  const words = await db.prepare('SELECT id, lesson_id, term, reading, meaning, romaji, part_of_speech FROM vocabulary WHERE course_id = ? AND is_active = 1').bind(courseId).all();
  const lessonOrderById = new Map(lessonRows.map(item => [item.id, Number(item.order_index)]));
  const existingByKey = new Map((words.results || []).map(item => [`${lessonOrderById.get(item.lesson_id) || 0}\u0000${item.term}\u0000${item.reading}`, item]));
  const currentWordCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM vocabulary WHERE course_id = ? AND is_active = 1').bind(courseId).first())?.count || 0);
  const missingLessonOrders = new Map();

  const items = rows.map(row => {
    const errors = [];
    const useFallbackLesson = !row.lessonOrder && !row.lessonTitle;
    const targetLessonOrder = row.lessonOrder || (useFallbackLesson && fallbackLesson ? Number(fallbackLesson.order_index) : 0);
    const targetLessonTitle = row.lessonTitle || (useFallbackLesson && fallbackLesson ? fallbackLesson.title : '');
    if (!targetLessonOrder) errors.push('课时为空时，请先在页面选择一个当前课时，或在 Excel 中填写课时序号');
    const lessonTitleError = validateUserText('课时名称', targetLessonTitle, FIELD_LIMITS.title);
    const wordErrors = validateWordFieldErrors(row);
    if (lessonTitleError) errors.push(lessonTitleError);
    errors.push(...wordErrors);
    const lesson = lessonByOrder.get(targetLessonOrder);
    if (targetLessonOrder && !lesson) {
      missingLessonOrders.set(targetLessonOrder, targetLessonTitle || `第${targetLessonOrder}课`);
    }
    const current = existingByKey.get(`${targetLessonOrder}\u0000${row.term}\u0000${row.reading}`);
    const changed = current && (
      current.meaning !== row.meaning
      || (current.romaji || '') !== row.romaji
      || (current.part_of_speech || '未分类') !== row.partOfSpeech
    );
    return {
      ...row,
      lessonOrder: targetLessonOrder,
      lessonTitle: targetLessonTitle,
      lessonId: lesson?.id || '',
      previous: current || null,
      status: errors.length ? 'error' : current ? changed ? 'update' : 'same' : 'create',
      errors
    };
  });

  const createCount = items.filter(item => item.status === 'create').length;
  if (lessonRows.length + missingLessonOrders.size > USER_LESSON_LIMIT) {
    for (const item of items) {
      if (!item.lessonId) {
        item.status = 'error';
        item.errors.push(`课时总数不能超过 ${USER_LESSON_LIMIT}`);
      }
    }
  }
  const vocabularyLimit = vocabularyLimitForCourse(course);
  if (currentWordCount + createCount > vocabularyLimit) {
    for (const item of items) {
      if (item.status === 'create') {
        item.status = 'error';
        item.errors.push(`词条总数不能超过 ${vocabularyLimit}`);
      }
    }
  }

  return {
    items,
    mapping: rows.mapping || null,
    lessonsToCreate: [...missingLessonOrders.entries()].map(([order, title]) => ({ order, title })),
    summary: {
      total: items.length,
      create: items.filter(item => item.status === 'create').length,
      update: items.filter(item => item.status === 'update').length,
      same: items.filter(item => item.status === 'same').length,
      error: items.filter(item => item.status === 'error').length,
      lessonsToCreate: missingLessonOrders.size
    }
  };
};

const previewCatalogImport = async (db, user, payload) => dataResponse(await buildCatalogImportPreview(db, user, payload));

const commitCatalogImport = async (db, user, payload) => {
  const courseId = String(payload.courseId || '').trim();
  const course = await assertOwnedCourse(db, user, courseId);
  const preview = await buildCatalogImportPreview(db, user, payload);
  if (preview.summary.error) return jsonResponse('导入内容仍有错误，请先修正后再写入', 400);
  for (const lesson of preview.lessonsToCreate) {
    if (await db.prepare('SELECT id FROM lessons WHERE course_id = ? AND order_index = ? AND is_active = 1').bind(courseId, lesson.order).first()) continue;
    await db.prepare(`INSERT INTO lessons
      (id, course_id, title, order_index, description, owner_user_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(`lesson-${crypto.randomUUID()}`, courseId, lesson.title || `第${lesson.order}课`, lesson.order, ownerUserIdForCourse(course, user))
      .run();
  }

  let created = 0;
  let updated = 0;
  const lessons = await db.prepare('SELECT id, order_index FROM lessons WHERE course_id = ? AND is_active = 1').bind(courseId).all();
  const lessonByOrder = new Map((lessons.results || []).map(item => [Number(item.order_index), item]));

  for (const item of preview.items) {
    if (item.status === 'same') continue;
    const lesson = lessonByOrder.get(item.lessonOrder);
    if (!lesson) continue;
    if (item.status === 'update' && item.previous?.id) {
      await db.prepare(`UPDATE vocabulary
        SET meaning = ?, romaji = ?, part_of_speech = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND course_id = ?`)
        .bind(item.meaning, item.romaji, item.partOfSpeech, JSON.stringify({ tags: item.tags }), item.previous.id, courseId)
        .run();
      updated += 1;
    } else if (item.status === 'create') {
      const maxRow = await db.prepare('SELECT COALESCE(MAX(source_row), 0) AS max_row FROM vocabulary WHERE course_id = ?').bind(courseId).first();
      await db.prepare(`INSERT INTO vocabulary
        (id, course_id, lesson_id, term, reading, meaning, romaji, part_of_speech, tags, source_row, updated_at, is_active, deleted_at, accent_display, part_of_speech_code, owner_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, NULL, '', '', ?, CURRENT_TIMESTAMP)`)
        .bind(`word-${crypto.randomUUID()}`, courseId, lesson.id, item.term, item.reading, item.meaning, item.romaji, item.partOfSpeech, JSON.stringify({ tags: item.tags }), Number(maxRow?.max_row || 0) + 1, ownerUserIdForCourse(course, user))
        .run();
      created += 1;
    }
  }
  await db.prepare('UPDATE courses SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(courseId).run();
  return dataResponse({ ok: true, created, updated, skipped: preview.summary.same, lessonsCreated: preview.summary.lessonsToCreate });
};

const handleCatalog = async (request, env) => {
  const { db, user } = await requireUser(request, env);
  await ensureCatalogRuntimeSchema(db);
  if (request.method === 'GET') return dataResponse(await listCatalog(db, user));
  if (request.method !== 'POST') return jsonResponse('Method not allowed', 405);
  const payload = await parseJson(request);
  const action = String(payload.action || '');
  if (action === 'createCourse') return createCatalogCourse(db, user, payload);
  if (action === 'updateCourse') return updateCatalogCourse(db, user, payload);
  if (action === 'deleteCourse') return deleteCatalogCourse(db, user, payload);
  if (action === 'shareCourse') return shareCatalogCourse(db, user, payload);
  if (action === 'createLesson') return createCatalogLesson(db, user, payload);
  if (action === 'updateLesson') return updateCatalogLesson(db, user, payload);
  if (action === 'deleteLesson') return deleteCatalogLesson(db, user, payload);
  if (action === 'createWord') return createCatalogWord(db, user, payload);
  if (action === 'updateWord') return updateCatalogWord(db, user, payload);
  if (action === 'deleteWord') return deleteCatalogWord(db, user, payload);
  if (action === 'previewImport') return previewCatalogImport(db, user, payload);
  if (action === 'commitImport') return commitCatalogImport(db, user, payload);
  return jsonResponse('未知课件操作', 400);
};

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const spreadsheetColumn = (index) => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

const buildTemplateRows = () => [
  IMPORT_TEMPLATE_HEADERS,
  ['1', '第1课', '私', 'わたし', 'watashi', '我', '名词', ''],
  ['', '', '食べます', 'たべます', 'tabemasu', '吃', '动词', '']
];

const handleCatalogTemplateCsv = () => {
  const rows = buildTemplateRows();
  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return textResponse(`\uFEFF${csv}\n`, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="baiduminasan-vocabulary-template.csv"'
  });
};

const handleCatalogTemplate = () => {
  const rows = [
    ...buildTemplateRows(),
    [],
    ['填写说明'],
    ['课时序号和课时名称可留空；留空时导入到页面当前选中的课时。'],
    ['如果填写课时序号，范围为 1-200；不存在的课时会在确认写入时自动创建。'],
    ['日文、假名、释义为必填字段。'],
    ['罗马音、词性、标签可选。'],
    ['上传后先解析预览，确认无错误再写入。']
  ];
  const sheetData = rows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const ref = `${spreadsheetColumn(cellIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const files = [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    },
    {
      name: 'docProps/core.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Baiduminasan Vocabulary Template</dc:title><dc:creator>Baiduminasan</dc:creator></cp:coreProperties>'
    },
    {
      name: 'docProps/app.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Baiduminasan</Application></Properties>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="词库导入模板" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="8" width="18" customWidth="1"/></cols><sheetData>${sheetData}</sheetData></worksheet>`
    }
  ];
  return binaryResponse(createZip(files), {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="baiduminasan-vocabulary-template.xlsx"'
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
  courseId: item.course_id,
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
      WHERE user_id = ?
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
    if (!lessonId) return jsonResponse('lessonId is required', 400);
    const courseId = typeof payload.courseId === 'string' && payload.courseId ? payload.courseId : SYSTEM_COURSE_ID;
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, mistake_key) DO UPDATE SET
        item_id = excluded.item_id,
        mode = excluded.mode,
        lesson_id = excluded.lesson_id,
        course_id = excluded.course_id,
        prompt = excluded.prompt,
        meaning = excluded.meaning,
        speech = excluded.speech,
        answers = excluded.answers,
        wrong_count = MAX(wrong_count + 1, excluded.wrong_count),
        last_wrong_at = excluded.last_wrong_at`)
      .bind(user.id, key, id, mode, lessonId, courseId, prompt, meaning, speech, JSON.stringify(answers), wrongCount, lastWrongAt)
      .run();
    const row = await db.prepare('SELECT * FROM mistake_progress WHERE user_id = ? AND mistake_key = ?')
      .bind(user.id, key)
      .first();
    return dataResponse({ ok: true, record: mistakeRowToRecord(row) });
  }

  const courseId = typeof payload.courseId === 'string' && payload.courseId ? payload.courseId : SYSTEM_COURSE_ID;
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
      if (url.pathname === '/api/catalog/template.xlsx') return handleCatalogTemplate();
      if (url.pathname === '/api/catalog/template.csv') return handleCatalogTemplateCsv();
      if (url.pathname === '/api/catalog') return handleCatalog(request, env);
      if (url.pathname === '/api/admin/duolingo' || url.pathname === '/api/duolingo') return jsonResponse('内置 Duolingo 词库入口已移除，请使用用户自定义词库', 410);
      if (url.pathname === '/api/progress') return handleProgress(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (isResponse(error)) return error;
      return jsonResponse('Internal server error', 500);
    }
  }
};
