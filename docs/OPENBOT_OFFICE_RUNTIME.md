# OpenBot Virtual Office (OVO) — Runtime & Operations (as implemented)

`OpenBot Virtual Office`, shortened to **OVO**, visualises OpenBot's ongoing work as a 2D pixel-art
office. It is an **observer**: no chat, no instruction box, no way to command an agent. Tasks are
given in OpenBot; OVO only renders the result.

How the app runs today: process topology, ports, data access, polling, environment
variables, verification and failure modes.

**Status of record (2026-11-20):** the app supports **Vite dev** (`npm run dev`), **Vite preview** (`npm run preview`), and the **production Node server** (`npm start` → `node server.ts` or Docker Compose via `dist-server/server.mjs`). All three share the same API handlers from `vite-plugin-openbot.ts` and read `PORT` from `.env` (default `3000`). Values marked **[measured]** were produced by commands quoted in this page; anything not marked is code-derived.

Contract and schema: `OPENBOT_OFFICE_API.md`. Wiring walkthrough:
`OPENBOT_OFFICE_GUIDE.md`.

---

## 1. Summary

```text
OpenBot app ──writes──▶ openbot.db (WAL, ~450 MB)
                              │  readonly: true, fileMustExist: true
                              ▼
                    Vite dev server / server.ts (0.0.0.0:${PORT:-3000})
                    ├── src/ (dev) or dist/ (production)
                    ├── GET /healthz                ← health probe (server.ts)
                    └── GET /api/*                  ← handleOpenBotApi() in vite-plugin-openbot.ts
                              ▲  poll every 3 s
                              │
                          browser (React + Zustand + PixiJS)
```

- One process: Vite in dev/preview or `node server.ts` (`dist-server/server.mjs` in Docker) in production. It serves the app **and** the read-only API endpoints on the same origin.
- Internal identifiers: npm package `openbot-virtual-office`, browser tab title
  `OpenBot Virtual Office (OVO)`.
- The project has **no database of its own**. It reads OpenBot's database read-only.
- Realtime is polling. OpenBot has no webhook, no SSE, no socket for "agent changed" — only
  file and table changes.

Important consequence: **the DB schema is not a public API.** OpenBot can change tables
without notice. The reader must tolerate missing columns and degrade quietly, which is why
one unparseable `agent_json` row costs one agent, not the whole list.

---

## 2. Runtime topology

### 2.1 Development

```
npm run dev ──▶ Vite dev server (0.0.0.0:${PORT:-3000})
├── src/ (HMR, ESM)
└── /api/* ──▶ openBotApiPlugin().configureServer ──▶ SQLite (read-only)
```

`vite.config.ts` registers `react()` and `openBotApiPlugin()`, reading `PORT` directly from `.env*` files (default `3000`). The plugin attaches `/api/agents`, `/api/office-avatar`, and `/api/office-profile`, and closes the SQLite handle on `httpServer` close.

### 2.2 Preview

```
npm run preview ──▶ Vite preview server (0.0.0.0:${PORT:-3000})
├── dist/ served as static files
└── /api/* ──▶ openBotApiPlugin().configurePreviewServer ──▶ SQLite (read-only)
```

`configurePreviewServer` attaches the exact same OpenBot API middleware as `configureServer`, on the same `.env`-configured `PORT` (default `3000`).

### 2.3 Production (`server.ts` & Docker Compose)

```
npm start (node server.ts)  OR  docker compose up -d --build (dist-server/server.mjs)
├── dist/ served as static files (SPA fallback + immutable /assets/* cache)
├── GET /healthz ──▶ 200 {"ok":true}
└── /api/* ──▶ handleOpenBotApi() ──▶ SQLite (read-only)
```

`server.ts` runs on built-in `node:http` with zero extra server framework dependencies. It loads `.env` (`process.loadEnvFile`), binds `HOST` (default `0.0.0.0`) and `PORT` (default `3000`), and closes the HTTP server and SQLite handle on `SIGINT` / `SIGTERM`.

The `Dockerfile` uses a multi-stage `node:22-alpine` build: compiles `dist/`, bundles + minifies `server.ts` into `dist-server/server.mjs` (~456 KB via `esbuild`), copies only minimal `better-sqlite3` runtime files (omitting frontend packages like `pixi.js`, C++ build sources, and `npm`/`corepack`), and runs as non-root `USER node`.

### 2.4 Ports

| Mode | Port | Serves | API |
|---|---|---|---|
| dev (`npm run dev`) | `3000` default (override via `.env` `PORT`) | app + HMR | `/api/agents`, `/api/office-avatar`, `/api/office-profile` |
| preview (`npm run preview`) | `3000` default (override via `.env` `PORT`) | `dist/` static | `/api/agents`, `/api/office-avatar`, `/api/office-profile` |
| production (`npm start` / Docker) | `3000` default (override via `.env` `PORT`) | `dist/` static + `/healthz` | `/api/agents`, `/api/office-avatar`, `/api/office-profile` |

### 2.5 Exposure

Both Vite and `server.ts` restrict API `Host` headers to loopback (`localhost`, `127.0.0.1`, `::1`, `127.0.0.0/8`) by default to prevent DNS rebinding. For LAN, reverse-proxy, or custom container domains, add allowed hostnames to `ALLOWED_HOSTS` in `.env` (comma-separated, or `*` if explicitly desired behind a trusted proxy). Treat any public exposure without TLS + auth as public read-only telemetry.

---

## 3. Data source access

### 3.1 File

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/OpenBot/openbot.db` |
| Linux | `~/.config/OpenBot/openbot.db` (untested) |
| Windows | `%APPDATA%\OpenBot\openbot.db` (untested) |

**[measured]** `-rw------- 1 <user> <group> 445M <date> <time>`. WAL mode; the OpenBot app
writes to it continuously.

Override with `OPENBOT_DB_PATH`. `OPENBOT_DB` in older documents is **not** read.

### 3.2 Handle

```ts
db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
```

- Module-level singleton, opened on first request, closed on plugin teardown.
- `fileMustExist: true` means a missing DB throws — it never silently creates an empty file.
- Eleven statements are prepared per `fetchAgentProfiles()` call and reused across agents.

### 3.3 Mandatory rules

- **Never** run `VACUUM`, never change `PRAGMA journal_mode`, never delete `-wal` / `-shm`.
  All three can corrupt the live DB.
- **The DB directory must stay writable.** SQLite creates `-shm` / `-wal` for read-only
  consumers too, so a read-only bind mount fails unless both files already exist.
- **No ORM.** Prisma and TypeORM lock and migrate; point neither at this file.
- **No write path exists and none should be added.** The Office UI is a viewer.

### 3.4 Not an integration path

- OpenBot has no official REST API for the agent list.
- Desktop app ports are not data endpoints.
- Never put tokens or credentials in URLs. Loopback is the boundary today.

---

## 4. Polling

**[measured]** `startPolling(Number(import.meta.env.VITE_OFFICE_POLL_MS ?? 3000))` is called
once from `GameCanvas.tsx`; `useStore.ts` owns a `setInterval`. Each tick fetches
`/api/agents`, and the server recomputes `phase` from the database.

There is no ETag, no `304`, no compression: every tick transfers the whole body
(**[measured]** ~4.7 KB for 16 agents). No page reload is needed after a deploy-adjacent
change — HMR or one poll tick catches up.

The sidebar header keeps its own, slower loop: `HUD.tsx` refetches `/api/office-avatar` and
`/api/office-profile` every **20 s**, and again on window `focus`. Those two change rarely,
so they do not share the 3 s roster cadence.

Rules:

- **Never go below 1 s** without measurement. Every request opens a DB scan over
  `agent_usage_activity` (~1,760 rows at capture) on a database OpenBot is still writing.
- Keep one connection and prepared statements, not one handle per request.
- On failure keep the last good snapshot and an offline flag; never render an empty office.
  Today the client falls back to mock data instead, which is visually indistinguishable from
  live data — check the source badge before believing the screen.
- Phase windows are recomputed per request against `Date.now()`:

| Constant | Value | Effect |
|---|---|---|
| `STATUS_WINDOW_MS` | 90 s | `working` needs evidence inside this window |
| `RESTART_WINDOW_MS` | 5 min | restart marker freshness |
| `READY_WINDOW_MS` | 10 min | `ready` needs the session to have moved |
| `SESSION_STALE_MS` | 30 min | grace ceiling, then `idle` |

The age checks are the only honest liveness signal. Without them a dead agent keeps a green
`Ready` badge for days, because the projection layer never closes abandoned sessions.

### 4.1 Alternatives (not implemented)

| Option | Notes |
|---|---|
| File watch on `openbot.db` / `openbot.db-wal` | Lowest latency, no polling cost; needs debouncing and a fallback |
| SSE / WebSocket from a real server | Push instead of poll, but requires the production server that does not exist yet |

Do not add a query inside a per-agent loop: N+1 grows linearly with roster size.

### 4.2 Anti-patterns

- `SELECT *` over `agent_usage_activity` without `LIMIT` on every tick.
- Opening and closing a `Database` handle per request.
- Relying on `sort_order` alone — keep an `agent_id` tie-breaker for stable ordering.
- Treating HTTP `200` as health (see §6.2).

---

## 5. Operations

### 5.1 Start and stop

There is no `start-office.sh`, no `stop-office.sh`, and no `logs/office.pid`. The app is
started by hand:

```bash
cd /path/to/openbot-virtual-office
npm run dev                     # Vite dev server (default http://localhost:3000, or .env PORT)
# or production / container:
npm run build && npm start      # Node server on PORT (default 3000)
docker compose up -d --build    # Alpine container on ${PORT:-3000}
```

Stop local Node processes by PID rather than `pkill -f vite` so unrelated dev servers are untouched:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # find PID on configured PORT
kill <pid>                         # SIGTERM
```

If a process ignores `SIGTERM`, escalate to `SIGKILL` on that PID only.

### 5.2 Process lifecycle

Locally, `npm run dev` / `npm start` run in the foreground session. When deployed with `docker-compose.yml`, the container uses `restart: unless-stopped` and monitors `/healthz`.

### 5.3 Health check

`server.ts` (production / Docker) exposes `GET /healthz`, returning `200 {"ok":true}`. For Vite dev/preview (which do not serve `/healthz`) or to verify live DB reads end to end, probe `/api/agents`:

```bash
curl -s http://127.0.0.1:3000/healthz                     # {"ok":true} on server.ts
curl -s http://127.0.0.1:3000/api/agents | head -c 1      # '[' means JSON
curl -sI http://127.0.0.1:3000/api/agents | grep -i content-type
```

A JSON array of agents confirms the API is attached. `text/html` means the request hit a static-only host.

### 5.4 Failure modes

| Symptom | Cause | Action |
|---|---|---|
| `EADDRINUSE` on start | previous instance still bound | find the PID on that port, stop it, re-check |
| `curl` returns nothing / `000` | no process listening | start dev/prod server; check `.env` `PORT` |
| `/api/agents` → `421 Misdirected request` | non-loopback `Host` header | add hostname to `ALLOWED_HOSTS` in `.env` |
| `/api/agents` → `200 text/html` | static-only host without Node middleware | run `npm run dev`, `npm start`, or Docker Compose |
| `/api/agents` → `500` | query or `agent_json` parse failure (or no DB mounted) | check `OPENBOT_DB_PATH` / container volume mount |
| UI shows agents but numbers look canned | mock fallback after a failed fetch | check the source badge; verify `/api/agents` returns JSON |
| `SQLITE_CANTOPEN` / `fileMustExist` throw | DB moved or path wrong | check `OPENBOT_DB_PATH` and that the file exists |
| `SQLITE_BUSY` | long read against a busy writer | shorten the query, keep one connection, never write |
| roster all `idle` / `Standby` | 30 min with no traffic by design | not a bug; see §4 |
| office freezes but page is alive | polling stopped (hidden tab, error loop) | check the network tab and the console |

### 5.5 Security boundaries

- API `Host` allowlist defaults to loopback (`127.0.0.1`, `localhost`, `::1`); foreign hosts get `421` unless explicitly added via `ALLOWED_HOSTS` (DNS-rebinding defence).
- `GET` / `HEAD` only → other methods `405`.
- Security headers on every API response: `nosniff`, `DENY`, `no-referrer`, CSP `self`.
- Static serving in `server.ts` resolves paths inside `dist/` (`403` outside `dist/`).
- No secrets, DB paths, or machine paths in any `VITE_`-prefixed variable; they are inlined
  into public JavaScript at build time.

---

## 6. Build and static assets

### 6.1 Build

```bash
npm run build      # tsc --noEmit && tsc -p tsconfig.node.json --noEmit && vite build
```

`better-sqlite3` is externalised, so the browser bundle stays browser-safe.
`dist/` is immutable per build: never edit files in place, always rebuild.

### 6.2 Static serving rules (`server.ts`)

- Serves from `dist/`; extensionless non-API routes fall back to `dist/index.html`.
- Resolves every requested path and confirms it stays inside `dist/`; anything outside → `403`.
- Sends `no-cache` for `.html` and `public, max-age=31536000, immutable` for hashed `/assets/*`.

---

## 7. Environment variables

| Variable | Consumer | Status | Purpose |
|---|---|---|---|
| `PORT` | `vite.config.ts`, `server.ts`, `docker-compose.yml` | **in use** | HTTP listen/host port, default `3000` |
| `HOST` | `server.ts` | **in use** | Bind address for production server, default `0.0.0.0` |
| `OPENBOT_DB_PATH` | Node side (`openbotSource.node.ts`) | **in use** | DB file override |
| `ALLOWED_HOSTS` | `vite-plugin-openbot.ts` | **in use** | Comma-separated extra API `Host` headers (`*` for all) |
| `VITE_OFFICE_POLL_MS` | browser (`GameCanvas.tsx`) | **in use** | poll interval, default `3000` |

Not read by anything: `OPENBOT_DB`, `NO_BUILD`, `OFFICE_API_URL`.

In Vite (`vite.config.ts`), `PORT` is read from `.env*` files (falling back to `3000`), while `loadEnv` forwards `OPENBOT_DB_PATH` and `ALLOWED_HOSTS` into `process.env`. In production (`server.ts`), `process.loadEnvFile()` loads `.env` if present without overriding container-injected env vars. `VITE_`-prefixed keys are inlined at build time by Vite.

---

## 8. Verification runbook

```bash
# 1. types, then build
npx tsc --noEmit
npm run build

# 2. all gates: source, monitor, lounge, avatar, chairs, idle, labels, rack LEDs,
#    rooms, store, workspace (each one runs with node alone)
npm run verify

# 2b. a single gate, if you only want one
node --import ./scripts/register-ts.mjs scripts/verify-monitor.mjs

# 3. endpoint reality (must be JSON, not HTML)
curl -s -o /dev/null -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\n' \
  http://127.0.0.1:3000/api/agents
curl -sI http://127.0.0.1:3000/api/agents | grep -i 'content-type\|cache-control'

# 4. guards
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/agents   # 405
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' \
  http://127.0.0.1:3000/api/agents                                                   # 421

# 5. DB truth, read-only
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT COUNT(*) FROM projection_agents;"

# 6. port is clean after stopping
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Step 4b — motion and performance in the browser (Chrome DevTools MCP, same page id):

| Check | How | Expected |
|---|---|---|
| reduced motion | `emulate { prefersReducedMotion: 'reduce' }` | `.status-track span` transition `0s`, mote layer hidden, breathe frozen |
| hidden tab | override `document.hidden` → `visibilitychange` | WebGL `drawElements` count stays flat, resumes on return |
| adaptive budget | block the main thread ~28 ms per frame | draw indices per second fall to ~⅓ while slow, recover after |

**[measured]** for step 3 on a verification run: `status=200 bytes=3296 time=0.087561`.
Both numbers drift with activity text and roster size; the useful signal is that the body
parses as a JSON array and `Content-Type` is `application/json`.

---

## 9. Known gaps

| Gap | Impact |
|---|---|
| No production server | `preview` and static hosts have no API; the UI falls back to mock |
| No `/health` | health must be inferred from `/api/agents` |
| No ETag / `304` / gzip | full body every 3 s |
| No supervisor | outages persist until a manual restart; supervision was declined |
| No offline indicator | a failed fetch looks like a live office with mock data |
| `SESSION_STALE_MS = 30 min` | a quiet roster reads `idle`, board looks empty |
| `starting` phase never produced | no agent rooms in it today; the render path (Lounge confinement) is ready but unexercised by live data |
| `restarting` Lounge placement | `restarting` needs a `%restart%` thread activity, so the Lounge pen was verified with a temporary phase override, never from live data |
| Roster > 16 agents | desks are capped at 16, so agents start sharing |
| No auth | the loopback bind is the entire boundary |

Not gaps — deliberate scope: there is no chat, no instruction box and no task-sending endpoint.
OVO observes OpenBot; instructions are authored in OpenBot itself.
