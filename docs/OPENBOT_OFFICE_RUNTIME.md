# OpenBot Virtual Office (OVO) — Runtime & Operations (as implemented)

`OpenBot Virtual Office`, shortened to **OVO**, visualises OpenBot's ongoing work as a 2D pixel-art
office. It is an **observer**: no chat, no instruction box, no way to command an agent. Tasks are
given in OpenBot; OVO only renders the result.

How the app runs today: process topology, ports, data access, polling, environment
variables, verification and failure modes.

**Status of record (2026-11-17):** the app runs as a Vite **dev server only**. There is no
production server, no `/health`, no pidfile, no start/stop script and no supervisor. Values
marked **[measured]** were produced by a command quoted in this page; anything not marked is
code-derived.

Contract and schema: `OPENBOT_OFFICE_API.md`. Wiring walkthrough:
`OpenBot-OFFICE-API-GUIDE.md`.

---

## 1. Summary

```text
OpenBot app ──writes──▶ openbot.db (WAL, ~450 MB)
                              │  readonly: true, fileMustExist: true
                              ▼
                    Vite dev server (localhost:5173)
                    ├── src/ (HMR, ESM)
                    └── GET /api/agents   ← middleware from vite-plugin-openbot.ts
                              ▲  poll every 3 s
                              │
                          browser (React + Zustand + PixiJS)
```

- One process today: the Vite dev server. It serves the app **and** the endpoint.
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

### 2.1 Development — the only supported mode

```
npm run dev ──▶ Vite dev server (localhost:5173)
├── src/ (HMR, ESM)
└── /api/agents ──▶ in-process middleware ──▶ SQLite (read-only)
```

`vite.config.ts` registers two plugins: `react()` and `openBotApiPlugin()`. The plugin's
`configureServer` hook attaches `/api/agents`; its `close` hook closes the SQLite handle.

**[measured]** `VITE v5.4.21 ready in 191 ms`, `Local: http://127.0.0.1:5199/` (the same
server on an alternate port for a verification run).

### 2.2 Preview — static bundle, no data

```
npm run preview ──▶ Vite preview server (localhost:4173)
└── dist/ served as static files
```

There is **no** preview hook in the plugin. **[measured]** `GET /api/agents` on the preview
port returns `200 text/html`: the SPA shell, not JSON. The client's Zod parse fails, it
returns an empty list, and the UI shows mock agents. Never use preview to judge live data.

### 2.3 Production — does not exist

No server process serves `dist/` together with an API. Production would need a real Node
process (see `OPENBOT_OFFICE_API.md` §9 for the target design). Until then, "deploy" means
"run the dev server somewhere reachable".

### 2.4 Ports

| Mode | Port | Serves | API |
|---|---|---|---|
| dev | `5173` (Vite default, `--port` to change) | app + HMR | `GET /api/agents` |
| preview | `4173` (Vite default) | `dist/` static | none — SPA fallback |
| production | — | — | — |

Port 8099 appears only in the unimplemented target design. `PORT`, `HOST` and
`OFFICE_API_URL` are read by nothing.

### 2.5 Exposure

The dev server binds loopback by default. A public tunnel (`ngrok`) has been used for
demos; that publishes the dev server, including HMR sockets and the read-only agent list,
to the internet with **no authentication**. Treat any tunnel URL as public: stop it when the
demo ends.

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
db = new Database(DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
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
(**[measured]** ~3.2 KB for 15 agents). No page reload is needed after a deploy-adjacent
change — HMR or one poll tick catches up.

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
npm run dev                     # Vite dev server on localhost:5173
```

Stop by PID, never by pattern. `pkill -f vite` can kill an unrelated project's dev server.

```bash
pgrep -f "vite --port 5199"     # find the exact PID
kill <pid>                      # SIGTERM
lsof -nP -iTCP:5173 -sTCP:LISTEN   # must be empty afterwards
```

If a process ignores `SIGTERM`, escalate to `SIGKILL` on that PID only.

### 5.2 Process lifecycle — the real risk

Both the dev server and any tunnel run unsupervised. They die when the parent shell or
session ends, or when the machine sleeps. There is no watchdog: a dead office stays dead
until someone restarts it.

Supervision (launchd, systemd, `--restart unless-stopped`) was offered and **declined** by
the operator: start on request only. Do not add a supervisor without being asked.

### 5.3 Health check

There is no `/health`. **[measured]** `GET /health` returns `200 text/html` (the SPA shell),
so it cannot distinguish a healthy process from a broken one.

Use this instead — it fails loudly when the API is not answering:

```bash
curl -s http://127.0.0.1:5173/api/agents | head -c 1     # '[' means JSON
curl -sI http://127.0.0.1:5173/api/agents | grep -i content-type
```

A JSON array of agents is a real answer. `text/html` means the plugin is not attached (for
example because you are on `preview`).

### 5.4 Failure modes

| Symptom | Cause | Action |
|---|---|---|
| `EADDRINUSE` on start | previous instance still bound | find the PID on that port, stop it, re-check |
| `curl` returns nothing / `000` | no process listening | start the dev server; check the port |
| `/api/agents` → `200 text/html` | not the dev server (preview or static host) | run `npm run dev`; the API is dev-only |
| `/api/agents` → `500` | query or `agent_json` parse failure | read the server log; the body never contains a DB path |
| UI shows agents but numbers look canned | mock fallback after a failed fetch | check the source badge; verify `/api/agents` returns JSON |
| `SQLITE_CANTOPEN` / `fileMustExist` throw | DB moved or path wrong | check `OPENBOT_DB_PATH` and that the file exists |
| `SQLITE_BUSY` | long read against a busy writer | shorten the query, keep one connection, never write |
| roster all `idle` / `Standby` | 30 min with no traffic by design | not a bug; see §4 |
| office freezes but page is alive | polling stopped (hidden tab, error loop) | check the network tab and the console |

### 5.5 Security boundaries

- Loopback only. Never bind `0.0.0.0` without TLS **and** auth; neither exists.
- `Host` allowlist → foreign hosts `421` (DNS-rebinding defence).
- `GET` / `HEAD` only → other methods `405`.
- Security headers on every API response: `nosniff`, `DENY`, `no-referrer`, CSP `self`.
- No secrets, DB paths, or machine paths in any `VITE_`-prefixed variable; they are inlined
  into public JavaScript at build time.

---

## 6. Build and static assets

### 6.1 Build

```bash
npm run build      # tsc --noEmit && vite build
```

**[measured]** `dist/` = 856 KB total; `dist/assets/index-*.js` = 562,268 bytes raw,
176,057 bytes gzip; main CSS 6,824 bytes. `better-sqlite3` is externalised, so the bundle
stays browser-safe.

`dist/` is immutable per build: never edit files in place, always rebuild.

### 6.2 Static serving rules (target, for whoever writes the server)

- Serve from `dist/`; unknown non-API paths fall back to `dist/index.html`.
- Resolve every requested path and confirm it is still inside `dist/`; anything outside → `403`.
- Do not cache `index.html` aggressively; hashed assets in `dist/assets/` are immutable.
- A weak `ETag` (`W/"size-mtime"`) on static files lets revalidation end in `304`.

These rules apply only once a real server exists. Today Vite's own static handling is used.

---

## 7. Environment variables

| Variable | Consumer | Status | Purpose |
|---|---|---|---|
| `OPENBOT_DB_PATH` | Node side (`openbotSource.node.ts`) | **in use** | DB file override |
| `VITE_OFFICE_POLL_MS` | browser (`GameCanvas.tsx`) | **in use** | poll interval, default `3000` |

Not read by anything — listed only so nobody assumes they work: `OPENBOT_DB`, `HOST`,
`PORT`, `NO_BUILD`, `OFFICE_API_URL`.

There is no `.env` file in the project. Only `VITE_`-prefixed keys reach the browser bundle,
which is exactly why DB paths and tokens must never carry that prefix.

---

## 8. Verification runbook

```bash
# 1. types, then build
npx tsc --noEmit
npm run build

# 2. source gate: phase rules, schema, bundle hygiene
node scripts/verify-openbot-source.mjs

# 2b. desk-screen gate: 12 phase × seated cases + source guards
node scripts/verify-monitor.mjs

# 3. endpoint reality (must be JSON, not HTML)
curl -s -o /dev/null -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\n' \
  http://127.0.0.1:5173/api/agents
curl -sI http://127.0.0.1:5173/api/agents | grep -i 'content-type\|cache-control'

# 4. guards
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:5173/api/agents   # 405
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' \
  http://127.0.0.1:5173/api/agents                                                   # 421

# 5. DB truth, read-only
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT COUNT(*) FROM projection_agents;"

# 6. port is clean after stopping
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

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
| Roster > 16 agents | desks are capped at 16, so agents start sharing |
| No auth | the loopback bind is the entire boundary |

Not gaps — deliberate scope: there is no chat, no instruction box and no task-sending endpoint.
OVO observes OpenBot; instructions are authored in OpenBot itself.
