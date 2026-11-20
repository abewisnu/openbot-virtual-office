import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { handleOpenBotApi } from './vite-plugin-openbot.ts';
import { closeOpenBotDb } from './src/data/openbotSource.node.ts';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional (container runtimes inject env vars directly)
}

function parsePort(raw: string | undefined, fallback = 3000): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

const PORT = parsePort(process.env.PORT, 3000);
const HOST = process.env.HOST?.trim() || '0.0.0.0';

const here = import.meta.dirname ?? process.cwd();
const DIST_DIR = existsSync(resolve(here, 'dist'))
  ? resolve(here, 'dist')
  : resolve(here, '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveFile(res: ServerResponse, filePath: string, method: string, cacheControl: string): void {
  const stat = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function handleStatic(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }

  if (pathname === '/healthz') {
    sendText(res, 200, '{"ok":true}', 'application/json; charset=utf-8');
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendText(res, 404, '{"error":"Not found"}', 'application/json; charset=utf-8');
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(DIST_DIR, rel);
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const cache =
        pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : extname(candidate) === '.html'
            ? 'no-cache'
            : 'public, max-age=3600';
      serveFile(res, candidate, method, cache);
      return;
    }
  } catch {
    /* fall through to SPA index or 404 */
  }

  const indexFile = resolve(DIST_DIR, 'index.html');
  if (!extname(pathname) && existsSync(indexFile)) {
    serveFile(res, indexFile, method, 'no-cache');
    return;
  }

  sendText(res, 404, 'Not found');
}

const server = createServer((req, res) => {
  if (handleOpenBotApi(req, res)) return;
  handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`OpenBot Virtual Office listening on http://${HOST}:${PORT}`);
});

const shutdown = () => {
  server.close(() => {
    closeOpenBotDb();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
