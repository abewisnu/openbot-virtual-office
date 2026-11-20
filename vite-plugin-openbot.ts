// Vite dev-only plugin: exposes GET /api/agents from the OpenBot SQLite
// database (read-only), plus the profile identity endpoints. One data path
// only: the agent endpoint delegates derivation to
// src/data/openbotSource.node.ts, so the endpoint, the CLI verifier and the UI
// share a single source of truth.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { fetchAgentProfiles, closeOpenBotDb, resolveDbPath } from './src/data/openbotSource.node.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Only raster formats are served. SVG is excluded on purpose: an SVG can carry
// script, and this endpoint must never become a way to inject markup.
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

const CONFIG_NAME = 'openbot-team-server-v2.json';

// Read only the fields we need. The same file also holds team-server private
// keys, so nothing else from it is ever forwarded to the browser.
const memberConfig = z.object({
  accountId: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  disabled: z.boolean().optional(),
  avatarUrl: z.string().optional(),
});

const openBotConfig = z.object({
  activeAccountId: z.string().optional(),
  hosts: z
    .array(
      z.object({
        members: z.array(memberConfig).optional(),
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
  // Any literal in 127.0.0.0/8 is loopback too. Nothing else is accepted by
  // default so a DNS name cannot be pointed at this port (rebinding).
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (v4 !== null && v4[1] === '127') return true;
  // Optional opt-in allowlist for container / reverse-proxy deployments.
  const rawAllowed = process.env.ALLOWED_HOSTS?.trim();
  if (!rawAllowed) return false;
  if (rawAllowed === '*') return true;
  const extra = rawAllowed
    .split(',')
    .map((h) => normalizeHost(h))
    .filter(Boolean);
  return extra.includes(name);
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'",
};

type OpenBotConfig = z.infer<typeof openBotConfig>;
type MemberConfig = z.infer<typeof memberConfig>;

function readOpenBotConfig(): OpenBotConfig | null {
  const root = dirname(resolveDbPath());
  try {
    return openBotConfig.parse(JSON.parse(readFileSync(join(root, CONFIG_NAME), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * The member this office speaks for: `activeAccountId` first, then the owner,
 * then the first enabled member. OpenBot may list several team servers, but the
 * office renders exactly one roster, so one member is resolved across all hosts.
 */
function pickActiveMember(config: OpenBotConfig): MemberConfig | undefined {
  const members = (config.hosts ?? []).flatMap((h) => h.members ?? []).filter((m) => !m.disabled);
  const active = config.activeAccountId;
  return (
    (active ? members.find((m) => m.accountId === active) : undefined) ??
    members.find((m) => m.role === 'owner') ??
    members[0]
  );
}

const EXT_MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

type AvatarHit = { bytes: Buffer; mime: string; source: 'remote' | 'stale' | 'disk' };

// The avatar URL only ever points at OpenBot's own avatar service. A fixed
// host allowlist plus a path prefix is the SSRF guard: a tampered local config
// can make this fetch, but it cannot point it at an internal address.
const AVATAR_HOST = 'api.openbot.run';
const AVATAR_PATH_PREFIX = '/v1/avatars/';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TTL_MS = 60_000;
const AVATAR_FETCH_TIMEOUT_MS = 5_000;

// In-memory layer, refreshed on demand; the disk layer under node_modules/.cache
// survives a dev-server restart so the office still shows the picture offline.
const avatarMemory = new Map<string, { bytes: Buffer; mime: string; fetchedAt: number }>();
const avatarInflight = new Map<string, Promise<AvatarHit | null>>();

function diskCacheDir(): string {
  return resolve(process.cwd(), 'node_modules/.cache/openbot-virtual-office/avatar');
}

function avatarCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function readDiskCache(url: string): Omit<AvatarHit, 'source'> | null {
  const key = avatarCacheKey(url);
  const dir = diskCacheDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.startsWith(key)) continue;
    const ext = name.slice(key.length + 1).toLowerCase();
    const mime = EXT_MIME[ext];
    if (!mime) continue;
    try {
      const file = resolve(dir, name);
      if (!file.startsWith(dir + sep)) continue;
      return { bytes: readFileSync(file), mime };
    } catch {
      /* try the next entry */
    }
  }
  return null;
}

function writeDiskCache(url: string, bytes: Buffer, mime: string): void {
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) return;
  try {
    const dir = diskCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${avatarCacheKey(url)}.${ext}`), bytes);
  } catch {
    /* cache is best-effort; serving never depends on it */
  }
}

/**
 * Fetches the active member's profile avatar through this dev server and
 * serves the raw image bytes to the browser. The URL comes from the local
 * OpenBot config and is validated against a fixed allowlist before any
 * network call. Fresh remote bytes win; a failed or slow fetch falls back
 * to the last in-memory copy and then to the on-disk cache, so the sidebar
 * never blanks out when the avatar service is unreachable.
 */
async function loadProfileAvatar(): Promise<AvatarHit | null> {
  const config = readOpenBotConfig();
  if (!config) return null;

  const chosen = pickActiveMember(config);
  const raw = chosen?.avatarUrl?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST || !url.pathname.startsWith(AVATAR_PATH_PREFIX)) {
    return null;
  }

  const fresh = avatarMemory.get(raw);
  if (fresh && Date.now() - fresh.fetchedAt < AVATAR_TTL_MS) {
    return { bytes: fresh.bytes, mime: fresh.mime, source: 'remote' };
  }

  const fetchRemote = async (): Promise<AvatarHit | null> => {
    try {
      const res = await fetch(raw, {
        signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!res.ok) return null;
      const contentLength = Number(res.headers.get('content-length') ?? Number.NaN);
      if (Number.isFinite(contentLength) && contentLength > AVATAR_MAX_BYTES) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength > AVATAR_MAX_BYTES) return null;
      const mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!IMAGE_MIME_EXT[mime]) return null;
      avatarMemory.set(raw, { bytes, mime, fetchedAt: Date.now() });
      writeDiskCache(raw, bytes, mime);
      return { bytes, mime, source: 'remote' };
    } catch {
      return null;
    }
  };

  let inFlight = avatarInflight.get(raw);
  if (!inFlight) {
    inFlight = fetchRemote();
    avatarInflight.set(raw, inFlight);
    void inFlight.finally(() => avatarInflight.delete(raw));
  }
  const remote = await inFlight;
  if (remote) return remote;

  // Remote missed: a stale in-memory copy beats nothing, then the disk cache.
  if (fresh) return { bytes: fresh.bytes, mime: fresh.mime, source: 'stale' };
  const onDisk = readDiskCache(raw);
  if (onDisk) return { ...onDisk, source: 'disk' };
  return null;
}


const MAX_NAME_LEN = 64;

type WorkspaceProfile = { name: string | null };

/**
 * Reads the *profile* name of the person using this OpenBot: the member entry in
 * `hosts[].members[]` whose `accountId` matches the config's `activeAccountId`.
 * Everything else in that file stays in the process, because it also holds
 * team-server private keys. The owner role and then the first enabled member are
 * the fallbacks; the email (`username`) is never used as a display name.
 *
 * OpenBot may list several team servers, but this chooses one member across all
 * of them, which matches the single roster the office draws from `openbot.db`.
 */
function loadWorkspaceProfile(): WorkspaceProfile {
  const config = readOpenBotConfig();
  if (!config) return { name: null };
  const chosen = pickActiveMember(config);

  const clean = (chosen?.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);

  return { name: clean.length > 0 ? clean : null };
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

function handleAgentsRequest(req: IncomingMessage, res: ServerResponse): void {
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
      avatarSeed: p.avatarSeed,
      workspaceBytes: p.workspaceBytes,
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

function handleAvatarRequest(req: IncomingMessage, res: ServerResponse): void {
  if (!isAllowedHost(req.headers.host)) {
    sendJson(res, 421, { error: 'Misdirected request' });
    return;
  }

  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
    return;
  }

  (async () => {
    // 204 is the "no avatar" signal: the UI shows its generated mark.
    const avatar = await loadProfileAvatar();
    if (!avatar) {
      res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': avatar.mime,
      'Content-Length': avatar.bytes.length,
      'Cache-Control': 'no-store',
      'X-Office-Avatar-Source': avatar.source,
      ...SECURITY_HEADERS,
    });
    if (method === 'HEAD') res.end();
    else res.end(avatar.bytes);
  })();
}

function handleProfileRequest(req: IncomingMessage, res: ServerResponse): void {
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
  sendJson(res, 200, loadWorkspaceProfile(), {}, method === 'HEAD');
}

/** Shared API dispatcher used by Vite dev/preview and the standalone Node server. */
export function handleOpenBotApi(req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname === '/api/agents') {
    handleAgentsRequest(req, res);
    return true;
  }
  if (pathname === '/api/office-avatar') {
    handleAvatarRequest(req, res);
    return true;
  }
  if (pathname === '/api/office-profile') {
    handleProfileRequest(req, res);
    return true;
  }
  return false;
}

export function openBotApiPlugin(): Plugin {
  return {
    name: 'openbot-api',
    configureServer(server) {
      server.middlewares.use('/api/agents', handleAgentsRequest);
      server.middlewares.use('/api/office-avatar', handleAvatarRequest);
      server.middlewares.use('/api/office-profile', handleProfileRequest);
      // Vite has no plugin `close` hook; the dev server's own lifecycle event is
      // the supported place to release the SQLite handle.
      server.httpServer?.on('close', closeOpenBotDb);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/agents', handleAgentsRequest);
      server.middlewares.use('/api/office-avatar', handleAvatarRequest);
      server.middlewares.use('/api/office-profile', handleProfileRequest);
      server.httpServer?.on('close', closeOpenBotDb);
    },
  };
}
