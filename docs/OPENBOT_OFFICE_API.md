# OpenBot Virtual Office (OVO) — Data Contract (as implemented)

`OpenBot Virtual Office`, shortened to **OVO**, visualises OpenBot's ongoing work as a 2D pixel-art
office. It is an **observer**: there is no chat, no instruction box, and no way to command an agent
from the office. Tasks are still given in OpenBot itself; OVO shows the consequences — who is
working, who is idle, who is waiting, and who has unread messages.

What the Vite frontend actually consumes today. Every statement here is backed by a
line in `src/`, `vite-plugin-openbot.ts` or a command whose output is quoted.

**Status of record (2026-11-17):** the only endpoint is `GET /api/agents`, served by the
Vite **dev-only** plugin. The production design (`/api/office` on port 8099, `/health`,
`start-office.sh`, ETag, gzip) is **not implemented**; it is kept in
[§9](#9-target-design--not-implemented) so it is never confused with shipped code.

---

## 1. Summary

| Item | Reality |
|---|---|
| Endpoint | `GET /api/agents` (and `HEAD`) — plus `GET /api/office-logo` for the workspace logo (§2.3) and `GET /api/office-profile` for the workspace name (§2.4) |
| Host | the Vite dev server itself, default `http://localhost:5173` |
| Provider | `vite-plugin-openbot.ts` → `configureServer` middleware |
| Availability | **dev only**. `vite preview` and any static host do **not** serve it |
| Response | bare JSON array, browser-safe subset, no envelope |
| Dataset | 15 agents, ~3.2 KB, ~80 ms first call on loopback |
| Status model | `phase` (7 values) + one `activity` (or `null`) |
| Realtime | browser polls every 3 s (`VITE_OFFICE_POLL_MS`) |
| Writes | none. Connection opened `readonly: true` |

There is no `/health`, no `/api/office`, no port 8099, no auth, no ETag, no gzip, and no
folder/sidebar-JSON grouping in the shipped app.

---

## 2. Endpoint contract

### 2.1 Request rules

| Rule | Behaviour | Evidence |
|---|---|---|
| Path | `/api/agents` only; any other `/api/*` is **not** intercepted | `configureServer` registers `'/api/agents'` |
| Methods | `GET`, `HEAD`; anything else → `405` + `Allow: GET, HEAD` | measured `POST /api/agents` → `405` |
| Host header | `127.0.0.1`, `localhost`, `::1`, `[::1]`, or a literal IPv4; otherwise → `421` | measured `Host: evil.example` → `421` |
| Cache | `Cache-Control: no-store` | measured response header |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'self'; script-src 'self'` | measured response headers |
| Errors | `500 { "error": "Agent data unavailable" }`; DB path and SQL never in the body | `vite-plugin-openbot.ts` catch block |

**Unknown paths fall through to the SPA.** `/health`, `/api/office` and `/api/nope` all
return `200 text/html` (the `index.html` shell). Measured:

```
/health     -> HTTP/1.1 200 OK, Content-Type: text/html
/api/office -> HTTP/1.1 200 OK, Content-Type: text/html
/api/nope   -> HTTP/1.1 200 OK, Content-Type: text/html
```

A `200` is therefore **not** proof of a working API. The client must parse the body; a
non-array or schema failure is treated as "no data" and the UI falls back to mock.

### 2.2 Response body

```json
[
  {
    "agentId": "agent-00000000-0000-0000-0000-000000000000",
    "name": "Example Agent",
    "role": "Example Role",
    "avatarColor": null,
    "avatarHue": 30,
    "phase": "idle",
    "activity": null,
    "unreadCount": 0
  }
]
```

Exactly these eight keys, in this order. `provider`, `model`, `threadId` and raw
`agent_json` are stripped server-side (`vite-plugin-openbot.ts:70-79`) before serialisation.
`activity` is either `null` or an object (§4).

Measured: `count 15`, keys as above, phases `{idle: 14, working: 1}` at capture time.

---

### 2.3 Workspace logo — `GET /api/office-logo`

| Item | Reality |
|---|---|
| Source | `openbot-team-server-v2.json` (same folder as `openbot.db`), field `hosts[].serverLogo` (`version`, `mimeType`) |
| File | `<app-support>/openbot-team-server-v2.json.assets/logo/<version>.<ext>`, else the **newest** allowed file in that folder when the config still names an older, missing version |
| Response | raw image bytes, `Content-Type` taken from the config (or the file extension in fallback mode), `Cache-Control: no-store`, `X-Office-Logo-Source: config \| newest` |
| No logo on disk | `204 No Content`, empty body — the UI keeps its own mark |
| Allowed types | `image/webp`, `image/png`, `image/jpeg`, `image/gif`; SVG is refused on purpose |
| Guards | Host allowlist → `421`, non-`GET`/`HEAD` → `405`, file stem re-validated, resolved path must stay inside the logo directory |
| Never leaves the process | the JSON config itself, because it also holds team-server private keys |

The sidebar renders this image only when the answer is `200` with an `image/*`
`Content-Type`; anything else keeps the built-in `VO` mark. Static hosts answer
`/api/office-logo` with `index.html`, so that content-type check is what holds the fallback.
Nothing is drawn before the first answer resolves, so a reload never flashes the green
`VO` tile. The browser re-reads the endpoint every 20 s and on window focus, so a logo
replaced inside OpenBot appears without a page reload.

---

### 2.4 Profile name — `GET /api/office-profile`

| Item | Reality |
|---|---|
| Source | `openbot-team-server-v2.json`, fields `activeAccountId` and `hosts[].members[]` |
| Response | `200 application/json` with `{ "name": "XSCODE" }`, `Cache-Control: no-store` |
| No name configured | `{ "name": null }` — not an error |
| Which member wins | the member whose `accountId` equals `activeAccountId`; else the first `role: "owner"`; else the first enabled member |
| Skipped members | `disabled: true` |
| Never used as a name | `username` (an e-mail address) |
| Sanitising | control characters become spaces, whitespace is collapsed, value trimmed and capped at 64 chars |
| Guards | same as §2.3: Host allowlist → `421`, non-`GET`/`HEAD` → `405` |
| Never leaves the process | `serverId`, `publicKey`, `privateKey`, `members[].username`, `sessions`, `invites` |

This is the **person's profile name** from OpenBot, not the team-server name
(`hosts[].serverName`, e.g. `xscode`). The sidebar header shows it and keeps the
neutral `Workspace` label when the answer is `null`, non-JSON, or missing. Static
hosts answer with `index.html`, so the `Content-Type` check is what holds that
fallback. The value is re-read on window focus and every 20 s.

### 2.4.1 Several team servers

OpenBot's config is an array, so a machine may hold several team servers
(`hosts[]`), while OVO renders the agent roster of exactly one SQLite database
(`openbot.db`). The schema has no per-server roster and no table named `server`,
`team`, or `workspace`, so multi-server rendering is **not supported**. The
profile name is therefore resolved across all hosts but only one person is shown.
Rendering a second roster would need a database path per server, which this build
does not have.

---

## 3. Phase derivation

`derivePhase()` in `src/data/openbotSource.node.ts:114-135` is the single decision point,
evaluated top-down; the first match wins.

| Order | Phase | Condition |
|---|---|---|
| 1 | `blocked` | at least one row in `agent_waits` with `woken_at IS NULL` |
| 2 | `restarting` | `projection_thread_activities.activity_type LIKE '%restart%'` newer than `RESTART_WINDOW_MS` |
| 3 | `working` | `projection_threads.active_turn_id IS NOT NULL`, **or** usage / turn / delivery evidence newer than `STATUS_WINDOW_MS` |
| 4 | `ready` | session `state = 'active'` **and** (`updated_at` within `READY_WINDOW_MS` **or** traffic within `SESSION_STALE_MS`) |
| 5 | `idle` | the agent has a session row at all |
| 6 | `stopped` | no session row |

`starting` exists in `AGENT_PHASES` but is **never produced** by the derivation. The office still
renders it defensively: while a phase is `starting`, `World.ts` confines that agent to the Lounge
room (`src/office/Lounge.ts`, gate `scripts/verify-lounge.mjs`) — it may stand, sit on a lounge sofa
or walk between lounge floor tiles, and never takes a desk, meeting chair or chat spot.

Windows (`src/data/openbotSource.node.ts:137-151`):

| Constant | Value | Meaning |
|---|---|---|
| `STATUS_WINDOW_MS` | `90_000` | "is doing work right now" |
| `RESTART_WINDOW_MS` | `5 * 60_000` | a restart marker only matters while fresh |
| `READY_WINDOW_MS` | `10 * 60_000` | the session must have moved this recently |
| `SESSION_STALE_MS` | `30 * 60_000` | grace ceiling before `ready` decays to `idle` |

Consequences that keep confusing readers:

- `ready` is **not** "has a session". The projection layer never closes abandoned
  sessions, so a session row alone would keep a dead agent green for days. Age is the
  only honest liveness signal.
- Past 30 minutes with no traffic, most of a quiet roster reads `idle` → sidebar shows
  `Standby`. An apparently empty board is correct, not a bug.
- Windows are computed against `Date.now()` per request, never stored.

---

## 4. Activity payload

`activity` is `null` or `{ kind, variant?, priority, resetsAt? }`.

`kind` ∈ `waiting | limited | routine | working | unread | responded`. Only four are ever
produced today (`src/data/openbotSource.node.ts:274-295`): `waiting`, `unread`,
`responded`, `working`. `limited` and `routine` are accepted by the schema but no branch
emits them.

Weights (`ACTIVITY_WEIGHT`, `src/data/openbotSource.node.ts:154-161`). Highest wins;
ties break on `kind` alphabetically for stable output.

| kind | weight | trigger |
|---|---|---|
| `waiting` | 100 | unwoken row in `agent_waits` |
| `limited` | 90 | *(never emitted)* |
| `unread` | 80 | `unreadCount > 0` |
| `responded` | 60 | last `agent_usage_activity` within `STATUS_WINDOW_MS` |
| `routine` | 40 | *(never emitted)* |
| `working` | 20 | `active_turn_id` present |

`unreadCount` is derived, not read: the read cursor
(`projection_thread_reads.through_message_id`) is mapped to an ordinal via
`projection_thread_messages`, then messages with a higher ordinal are counted. It compares
numeric ordinals, never TEXT message ids.

### 4.1 What the browser may display

`activity` never changes `phase` and never changes an indicator colour. It is rendered as
a text note only.

Labels come from `ACTIVITY_LABEL` in `src/constants.ts`:

| kind | label |
|---|---|
| `working` | `Working on turn` |
| `responded` | `Replied just now` |
| `waiting` | `Waiting` |
| `unread` | `Unread` |
| `limited` | `Limited` |
| `routine` | `Routine` |

Internal DB event names never reach the browser. The removed `activityType:
'turn.completed'` field was a hardcoded literal on both branches and leaked an internal
event name; the extra badge line that produced the run-together `RespondedReplied just
now` was removed with it. `.badge-row`, `.badge`, `.badge-label` and `.badge-note` have real CSS
(`display: flex`, `gap: 6px`).

---

## 5. Indicator colour = phase only

Every dot beside an agent name shows `PHASE_COLORS[phase]`: the sidebar rows in `HUD.tsx`,
the dot on the canvas name tag (`World.ts` → `Character.setDot`), and the dot in the detail
panel.

`badgeFor()` (`src/constants.ts`) returns `{ color, label, note? }`: colour and label from
the phase, `note` from the activity label. `ACTIVITY_COLORS` was deleted so activity can
never tint an indicator, because it collided with phases — `waiting` red looked like
`blocked`, `limited` amber like `restarting`, `unread` blue like `starting`,
`routine`/`responded` green like `ready`.

| phase | colour |
|---|---|
| `idle` | `#9ca3af` |
| `starting` | `#38bdf8` |
| `ready` | `#4ade80` |
| `working` | `#60a5fa` |
| `restarting` | `#f59e0b` |
| `blocked` | `#f87171` |
| `stopped` | `#6b7280` |

One consequence worth stating: the dot cannot show unread state. An agent with unread
messages still shows its phase colour; unread appears as the `Unread` note and as the
desk-walk behaviour (§6).

---

## 6. Derived UI behaviour

| Rule | Implementation |
|---|---|
| Simulated position | `statusForPhase(phase)`: `working`/`ready` are seated, everything else walks |
| Typing animation | only `phase === 'working'`, or an agent that owes its desk and is not `blocked` |
| Desk walk | `owesDesk = unreadCount > 0 || activity.kind ∈ {unread, waiting}` (`World.ts`) |
| Desk screen | `monitorStateFor(phase, seated)`: `working` moving, `ready` still, `blocked` grey with pause bars, everything else dark (`src/office/Monitor.ts`) |
| Blocked at the computer | `blocked` always carries `activity.kind === 'waiting'`, so `owesDesk` walks it to its own desk and it sits there with the grey screen until the prompt is answered, the approval is granted or the usage limit resets |
| Desk id | `WS-01 … WS-N`, one per agent in roster order (`useStore.ts`, `Layout.ts`) |
| Live caption | `Blocked — walking to desk` / `Blocked — waiting for your answer`, `Walking to desk — new instruction`, `At desk — reviewing new instruction`, or the status text |

The simulation `Status` (`idle | working | meeting | chatting | break`) drives *where* a
character stands. It is deliberately separate from `phase`, so the office keeps moving
when the database is unreadable.

---

## 7. Data source

### 7.1 File

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/OpenBot/openbot.db` |
| Linux | `~/.config/OpenBot/openbot.db` (untested here) |
| Windows | `%APPDATA%\OpenBot\openbot.db` (untested here) |

Measured on this machine: ~450 MB, WAL mode, written continuously by the OpenBot app.
The Office project has **no database of its own**.

Row counts and file sizes in this document are snapshots: they grow while OpenBot works.
Re-measure rather than trusting a number here.

### 7.2 Override

`OPENBOT_DB_PATH` (note the `_PATH` suffix), read by the Node side only, validated with
Zod (`src/data/openbotSource.node.ts:21-30`). It never reaches the bundle.

The older name `OPENBOT_DB` appears in [§9](#9-target-design--not-implemented) only. It is
**not** read by the current code — setting it has no effect.

### 7.3 Connection

`better-sqlite3` (a native Node addon, `package.json:12`), one process-wide singleton:

```ts
db = new Database(DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
```

- Opened once (`let db = null; if (db) return db`), closed on plugin teardown.
- `fileMustExist: true` → a missing file throws instead of silently creating an empty DB.
- Non-optional rules: no `VACUUM`, no `PRAGMA journal_mode` change, no deletion of
  `-wal` / `-shm`, no DDL, no DML. The DB **directory** must stay writable because SQLite
  creates `-shm` / `-wal` for readers too, so a read-only mount breaks unless both files
  already exist.
- No ORM. Prisma / TypeORM lock and migrate; never point one at this file.

### 7.4 Client-side safety

`better-sqlite3` is excluded from the bundle (`vite.config.ts` → `rollupOptions.external`
and `optimizeDeps.exclude`) and imported only by the Node module. Verified: no
`better-sqlite3` string in `dist/assets/`.

---

## 8. Tables read

Eleven prepared statements, all in `fetchAgentProfiles()`. Statements are prepared once per
call and reused per agent; there is no per-agent query inside a loop beyond these.

| Table | Used for | Rows (snapshot) |
|---|---|---|
| `projection_agents` | roster, `sort_order`, `thread_id`, `agent_json` | 15 |
| `agent_usage_activity` | last usage per agent — the proof of work | ~1,760 |
| `projection_provider_sessions` | session `state` + `updated_at` | ~176 |
| `agent_waits` | unwoken waits → `blocked` | 0 |
| `projection_threads` | `active_turn_id`, thread ownership | ~34 |
| `projection_thread_activities` | `turn.completed` / `delivery.completed`, `%restart%` | — |
| `projection_deliveries` | completed delivery as recent evidence | — |
| `projection_thread_reads` | read cursor per member/thread | — |
| `projection_thread_messages` | message ordinals (unread count, cursor lookup) | — |

Schema notes that matter:

- `agent_json` holds `{ name, title, description, model, … }`; it is parsed inside Zod, so
  one corrupt row degrades that agent only, never the whole endpoint.
- `projection_agents.updated_at` is configuration metadata, **not** proof of work. Using it
  would make every agent look permanently busy.
- There are no physical foreign keys. Deleted agents leave orphan rows, so joins must be
  `LEFT`-style or aggregate subqueries — a plain `JOIN` multiplies rows and breaks counts.
- `projection_threads` is the thread table; there is no `agents` or `agent_sessions` table
  in this database.

Other tables (`projection_agent_memories`, `projection_agent_routines`,
`projection_mcp_servers`, `workflows`, `agent_usage_records`, …) exist and may be read
later, but nothing in the app uses them today.

---

## 9. Target design — not implemented

Kept for reference only. Nothing in this section runs. If you are debugging the live app,
this is not where the answer is.

| Target item | Why it does not exist |
|---|---|
| `GET /api/office` on `127.0.0.1:8099` | no production server; the Vite plugin is dev-only |
| `GET /health` (`200` / `503`) | not implemented; requests hit the SPA fallback and return `200 text/html` |
| `scripts/start-office.sh`, `scripts/stop-office.sh`, `logs/office.pid` | no such files; `package.json` has only `dev`, `build`, `preview` |
| `server.proxy` / `preview.proxy` in `vite.config.ts` | not needed: the plugin answers on the same origin as the app |
| Weak `ETag` + `If-None-Match` → `304` | not implemented; every poll transfers the full body |
| `gzip` / `br` | not implemented |
| Envelope `{ ok, generatedAt, total, agents }` | the endpoint returns a bare array |
| Sidebar-JSON folder grouping | no folder code exists; `folder` / `folders` are absent from the payload |
| `PORT`, `HOST`, `NO_BUILD`, `OFFICE_API_URL` | read by nothing; the dev server decides host/port |
| Auth layer | none. The loopback bind is the boundary |
| Chat, instruction box, "send task" | **out of scope by design.** OVO is an observer; instructions are authored in OpenBot. No compose endpoint exists and none is planned |

Design summary, for whoever builds it: one process serves `dist/` and the API on one
origin so no CORS or token is needed; `/health` must run a real query so it distinguishes
"process alive" from "DB usable"; static paths must resolve inside `dist/` or return `403`;
`ETag` would turn unchanged polls into `304`.

---

## 10. Security rules

1. Bind loopback only. Widening past loopback needs TLS **and** auth first; today there is
   no auth, so the bind is the whole boundary.
2. The `Host` allowlist exists to stop DNS rebinding; foreign hosts get `421`.
3. `GET` / `HEAD` only; other methods `405`.
4. Security headers are set on every API response (§2.1).
5. Validate the payload at the client boundary with Zod
   (`agentProfileSchema`, `src/data/openbotSource.ts:99-108`). A schema mismatch is treated
   as "no data", never rendered as partial truth.
6. No DB path, SQL text, credential, or raw `agent_json` in any response body or client log.
7. No write endpoint exists, and none should be added to this database: it is OpenBot's
   live store.
8. Keep secrets and machine paths out of `VITE_`-prefixed variables — they are inlined into
   public JavaScript at build time.

---

## 11. Common pitfalls

1. **`projection_agents.updated_at` is not proof of work.** Use
   `agent_usage_activity.occurred_at`.
2. **`200` does not mean the API answered.** `/health` and `/api/office` return the HTML
   shell with status `200`. Check `Content-Type` and parse the body.
3. **`npm run preview` has no API.** It serves static `dist/`, so the client silently shows
   mock data. This is the most common false "it works on my machine".
4. **`OPENBOT_DB` is not read.** Use `OPENBOT_DB_PATH`.
5. **A quiet roster looks empty.** `ready` decays to `idle` after 30 min of no traffic by
   design.
6. **Never write to `openbot.db`.** Read-only handle, no pragmas, no migrations.
7. **Weak thresholds are guesses, not OpenBot facts.** If a number looks wrong, suspect the
   threshold before suspecting the database.

---

## 12. Verification commands

```bash
# roster payload from the dev server (must be JSON, not HTML)
curl -s http://127.0.0.1:5173/api/agents | head -c 300
curl -sI http://127.0.0.1:5173/api/agents | grep -i 'content-type\|cache-control'

# guards
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:5173/api/agents   # 405
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' \
  http://127.0.0.1:5173/api/agents                                                   # 421

# source gate (types, schema, phase rules, bundle hygiene)
node scripts/verify-openbot-source.mjs

# raw DB truth, read-only
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT COUNT(*) FROM projection_agents;"
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT agent_id, MAX(occurred_at) FROM agent_usage_activity GROUP BY agent_id;"
```
