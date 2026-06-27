import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { createAssetsBinding } from './assets.js';
import { createD1Database, describeD1Database } from './sqlite-d1.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.replace(/^['"]|['"]$/g, '');
  }
};

const ensureWorkerGlobals = () => {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  if (!globalThis.caches) {
    const memoryCache = new Map();
    globalThis.caches = {
      default: {
        async match(request) {
          const key = request.url || String(request);
          const cached = memoryCache.get(key);
          return cached ? cached.clone() : undefined;
        },
        async put(request, response) {
          const key = request.url || String(request);
          memoryCache.set(key, response.clone());
        }
      }
    };
  }
};

const requestBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});

const toFetchRequest = async (incoming, origin) => {
  const url = new URL(incoming.url || '/', origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = incoming.method || 'GET';
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await requestBody(incoming);
    init.body = body.length ? body : undefined;
  }
  return new Request(url, init);
};

const sendFetchResponse = async (outgoing, response) => {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  outgoing.writeHead(response.status, headers);
  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    outgoing.end(buffer);
  } else {
    outgoing.end();
  }
};

const isFetchResponse = (value) => value && typeof value === 'object'
  && typeof value.status === 'number'
  && typeof value.headers?.forEach === 'function'
  && typeof value.arrayBuffer === 'function';

const createExecutionContext = () => {
  const pending = [];
  return {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise).catch((error) => {
        console.error('[worker waitUntil]', error);
      }));
    },
    async drain() {
      await Promise.allSettled(pending);
    }
  };
};

const requireBuiltAssets = (distDir) => {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`Built frontend not found at ${distDir}. Run "npm run build" first.`);
  }
};

const main = async () => {
  loadEnvFile(path.join(projectRoot, '.env'));
  ensureWorkerGlobals();

  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 8788);
  const publicOrigin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
  const distDir = path.resolve(projectRoot, process.env.DIST_DIR || 'dist');
  const dbPath = path.resolve(projectRoot, process.env.MINASAN_SQLITE_PATH || '.aliyun/minasan.sqlite');
  const migrationsDir = path.resolve(projectRoot, process.env.MIGRATIONS_DIR || 'migrations');

  requireBuiltAssets(distDir);

  const [workerModule, db] = await Promise.all([
    import(pathToFileURL(path.join(projectRoot, 'worker/index.js')).href),
    createD1Database({ dbPath, migrationsDir })
  ]);

  const worker = workerModule.default;
  const env = {
    DB: db,
    ASSETS: createAssetsBinding(distDir)
  };
  const counts = await describeD1Database(db);
  console.log(`[minasan] independent data mode: Cloudflare D1 is not used`);
  console.log(`[minasan] seed counts: courses=${counts.courses}, lessons=${counts.lessons}, vocabulary=${counts.vocabulary}`);

  const server = http.createServer(async (incoming, outgoing) => {
    const context = createExecutionContext();
    try {
      const request = await toFetchRequest(incoming, publicOrigin);
      const response = await worker.fetch(request, env, context);
      await sendFetchResponse(outgoing, response);
    } catch (error) {
      if (isFetchResponse(error)) {
        await sendFetchResponse(outgoing, error);
        return;
      }
      console.error('[minasan server]', error);
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      outgoing.end(JSON.stringify({ error: 'Internal server error' }));
    } finally {
      context.drain();
    }
  });

  const shutdown = () => {
    console.log('\n[minasan] shutting down');
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('error', (error) => {
    console.error(`[minasan] failed to listen on ${host}:${port}`, error);
    db.close();
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`[minasan] listening on http://${host}:${port}`);
    console.log(`[minasan] public origin ${publicOrigin}`);
  });
};

main().catch((error) => {
  console.error('[minasan boot]', error);
  process.exit(1);
});
