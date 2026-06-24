const MAX_TEXT_LENGTH = 200;

const jsonResponse = (message, status) => new Response(JSON.stringify({ error: message }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

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

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tts') return handleTts(request, context);
    return env.ASSETS.fetch(request);
  }
};
