// Vite dev-only plugin: exposes GET /api/agents from the OpenBot SQLite
// database (read-only). One data path only: this plugin delegates derivation
// to src/data/openbotSource.node.ts, so the endpoint, the CLI verifier and the
// UI share a single source of truth.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { fetchAgentProfiles, closeOpenBotDb, DEFAULT_DB_PATH } from './src/data/openbotSource.node.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Only raster formats are served. SVG is excluded on purpose: an SVG can carry
// script, and this endpoint must never become a way to inject markup.
const LOGO_MIME_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

const CONFIG_NAME = 'openbot-team-server-v2.json';
const LOGO_DIR = `${CONFIG_NAME}.assets/logo`;

// Read only the two fields we need. The same file also holds team-server
// private keys, so nothing else from it is ever forwarded to the browser.
const serverLogoConfig = z.object({
  hosts: z
    .array(
      z.object({
        serverName: z.string().optional(),
        serverLogo: z
          .object({ version: z.string().min(1), mimeType: z.string().min(1) })
          .optional(),
      }),
    )
    .optional(),
});


function normalizeHost(host: string | undefined): string {
  if (!host) return '';
  const value = host.trim().toLowerCase();
  const bracketed = value.startsWith('[')
    ? value.slice(0, value.indexOf(']') + 1)
    : value.split(':')[0];
  return bracketed;
}

function isAllowedHost(host: string | undefined): boolean {
  const name = normalizeHost(host);
  if (!name) return false;
  if (LOOPBACK.has(name)) return true;
  // Literal IPv4 loopback / private ranges are allowed; DNS names are not.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name);
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'",
};

const SAFE_FILE_STEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const EXT_MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

type LogoHit = { bytes: Buffer; mime: string; source: 'config' | 'newest'; version: string };

/**
 * Reads the workspace logo that OpenBot itself stores next to its team-server
 * config. The version named in the config wins; if OpenBot replaced the picture
 * without bumping that field, the newest allowed file in the logo folder is used
 * instead, so a new logo shows up without waiting for the config to catch up.
 * Only the two identifying fields are parsed and the resolved path must stay
 * inside the logo directory.
 */
function loadServerLogo(): LogoHit | null {
  const root = dirname(DEFAULT_DB_PATH);
  const logoDir = resolve(root, LOGO_DIR);
  if (!logoDir.startsWith(resolve(root) + sep)) return null;

  let config: z.infer<typeof serverLogoConfig> | null = null;
  try {
    config = serverLogoConfig.parse(JSON.parse(readFileSync(join(root, CONFIG_NAME), 'utf8')));
  } catch {
    config = null;
  }

  const logo = config?.hosts?.find((h) => h.serverLogo)?.serverLogo;
  if (logo && SAFE_FILE_STEM.test(logo.version)) {
    const ext = LOGO_MIME_EXT[logo.mimeType];
    if (ext) {
      const file = resolve(logoDir, `${logo.version}.${ext}`);
      if (file.startsWith(logoDir + sep)) {
        try {
          return { bytes: readFileSync(file), mime: logo.mimeType, source: 'config', version: logo.version };
        } catch {
          /* fall through to the newest file */
        }
      }
    }
  }

  let names: string[] = [];
  try {
    names = readdirSync(logoDir).filter((n) => !n.startsWith('.'));
  } catch {
    return null;
  }

  const newest = names
    .map((name) => {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      const mime = EXT_MIME[ext];
      if (!mime || !SAFE_FILE_STEM.test(stem)) return null;
      const file = resolve(logoDir, name);
      if (!file.startsWith(logoDir + sep)) return null;
      try {
        return { file, mime, stem, mtime: statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((c): c is { file: string; mime: string; stem: string; mtime: number } => c !== null)
    .sort((a, b) => b.mtime - a.mtime)[0];

  if (!newest) return null;
  try {
    return { bytes: readFileSync(newest.file), mime: newest.mime, source: 'newest', version: newest.stem };
  } catch {
    return null;
  }
}


const MAX_NAME_LEN = 64;

/**
 * Reads the workspace name OpenBot stores in `hosts[].serverName`. Everything
 * else in that file stays in the process: it also holds team-server private
 * keys. Control characters are stripped and the value is capped so the sidebar
 * cannot be fed an unbounded or multi-line string.
 */
function loadWorkspaceName(): string | null {
  const root = dirname(DEFAULT_DB_PATH);
  let config: z.infer<typeof serverLogoConfig>;
  try {
    config = serverLogoConfig.parse(JSON.parse(readFileSync(join(root, CONFIG_NAME), 'utf8')));
  } catch {
    return null;
  }

  const name = config.hosts?.find((h) => h.serverName)?.serverName;
  if (!name) return null;
  const clean = name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
  return clean.length > 0 ? clean : null;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
  headOnly = false,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extra,
    'Content-Length': Buffer.byteLength(payload),
  });
  if (headOnly) res.end();
  else res.end(payload);
}

export function openBotApiPlugin(): Plugin {
  function handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (!isAllowedHost(req.headers.host)) {
      sendJson(res, 421, { error: 'Misdirected request' });
      return;
    }

    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
      return;
    }

    try {
      // Strip anything the browser does not need: provider/model/threadId.
      const agents = fetchAgentProfiles().map((p) => ({
        agentId: p.agentId,
        name: p.name,
        role: p.role,
        avatarColor: p.avatarColor,
        avatarHue: p.avatarHue,
        phase: p.phase,
        activity: p.activity,
        unreadCount: p.unreadCount,
      }));
      sendJson(res, 200, agents, {}, method === 'HEAD');
    } catch (err) {
      // Never ship a DB path or SQL text to the browser.
      console.error('[openbot-api]', err);
      sendJson(res, 500, { error: 'Agent data unavailable' });
    }
  }

  function handleLogoRequest(req: IncomingMessage, res: ServerResponse) {
    if (!isAllowedHost(req.headers.host)) {
      sendJson(res, 421, { error: 'Misdirected request' });
      return;
    }

    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
      return;
    }

    const logo = loadServerLogo();
    if (!logo) {
      // No workspace logo on this machine: the UI keeps its own mark.
      res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': logo.mime,
      'Content-Length': logo.bytes.length,
      'Cache-Control': 'no-store',
      'X-Office-Logo-Source': logo.source,
      ...SECURITY_HEADERS,
    });
    if (method === 'HEAD') res.end();
    else res.end(logo.bytes);
  }

  function handleProfileRequest(req: IncomingMessage, res: ServerResponse) {
    if (!isAllowedHost(req.headers.host)) {
      sendJson(res, 421, { error: 'Misdirected request' });
      return;
    }

    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
      return;
    }

    // `name: null` is a normal answer: the sidebar falls back to "Workspace".
    sendJson(res, 200, { name: loadWorkspaceName() }, {}, method === 'HEAD');
  }

  return {
    name: 'openbot-api',
    configureServer(server) {
      server.middlewares.use('/api/agents', handleRequest);
      server.middlewares.use('/api/office-logo', handleLogoRequest);
      server.middlewares.use('/api/office-profile', handleProfileRequest);
    },
    close() {
      closeOpenBotDb();
    },
  };
}
