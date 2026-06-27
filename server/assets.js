import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const headersFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const cacheable = filePath.includes(`${path.sep}assets${path.sep}`)
    || /\.(?:png|jpg|jpeg|webp|svg|ico|mp3|woff2?)$/i.test(filePath);
  return {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache'
  };
};

const readExistingFile = async (root, pathname) => {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(requested);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = path.join(root, normalized);

  if (!isInside(root, target)) return null;

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return null;
    return target;
  } catch {
    return null;
  }
};

export const createAssetsBinding = (distDir) => ({
  async fetch(request) {
    const url = new URL(request.url);
    const directFile = await readExistingFile(distDir, url.pathname);
    const filePath = directFile || path.join(distDir, 'index.html');

    try {
      const body = await fs.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: headersFor(filePath)
      });
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
});
