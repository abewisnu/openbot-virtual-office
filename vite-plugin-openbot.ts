// Vite dev-only plugin: exposes GET /api/agents from the OpenBot SQLite
// database (read-only). One data path only: this plugin delegates derivation
// to src/data/openbotSource.node.ts, so the endpoint, the CLI verifier and the
// UI share a single source of truth.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { fetchAgentProfiles, closeOpenBotDb } from './src/data/openbotSource.node.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

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

  return {
    name: 'openbot-api',
    configureServer(server) {
      server.middlewares.use('/api/agents', handleRequest);
    },
    close() {
      closeOpenBotDb();
    },
  };
}
