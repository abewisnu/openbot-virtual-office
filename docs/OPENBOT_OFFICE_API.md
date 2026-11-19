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
| Host | the Vite dev server itself, configured on `http://localhost:3000` |
| Provider | `vite-plugin-openbot.ts` → `configureServer` middleware |
| Availability | **dev only**. `vite preview` and any static host do **not** serve it |
| Response | bare JSON array, browser-safe subset, no envelope |
| Dataset | 16 agents, ~4.7 KB, ~80 ms first call on loopback (count follows the live roster) |
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
non-array body, invalid JSON or a non-2xx status raises `AgentSourceError`, which the
source policy turns into the mock fallback (§2.2.1).

### 2.2 Response body

```json
[
  {
    "agentId": "agent-00000000-0000-0000-0000-000000000000",
    "name": "Example Agent",
    "role": "Example Role",
    "avatarColor": null,
    "avatarHue": 30,
    "avatarSeed": "agent-00000000-0000-0000-0000-000000000000:face:41",
    "workspaceBytes": 136593408,
    "phase": "idle",
    "activity": null,
    "unreadCount": 0
  }
]
```

Exactly these ten keys, in this order. `avatarSeed` is OpenBot's face seed
(`projection_agents.agent_json.avatarSeed`, `/^[a-z0-9:-]{1,128}$/`); OVO derives the
pixel face from it (§2.5). `provider`, `model`, `threadId` and raw
`agent_json` are stripped server-side (`vite-plugin-openbot.ts:70-79`) before serialisation.
`activity` is either `null` or an object (§4). `workspaceBytes` is the measured
disk usage of the agent's workspace folder (§2.2.2); the folder path itself is never
sent.

Measured on loopback: `count 16`, 4753 bytes, keys as above, phases
`{idle: 9, ready: 4, working: 2, stopped: 1}` at capture time (a snapshot — the count follows the
live roster).

### 2.2.1 Client source states — `pending`, `openbot`, `mock`

The browser never opens on fabricated agents. `src/store/useStore.ts` boots with an
**empty** roster and `source: 'pending'`, then applies every fetch through the pure
policy `src/store/sourcePolicy.ts` → `resolveSource()`:

| Start state | Outcome | Employees | `source` | Sidebar badge |
|---|---|---|---|---|
| `pending`, empty | `ok` (array, ≥1 row) | live rows | `openbot` | `Live` + `N members` |
| `pending`, empty | `empty` (`[]`, valid) | `[]` | `openbot` | `Live` + `0 members` |
| `pending`, empty | `error` (network / non-2xx / non-JSON / non-array) | mock roster | `mock` | `Mock` + `N members` |
| `openbot`, live rows | `error` | **last live snapshot kept** | `openbot` | `Live` + `N members` |
| any | `pending` before first reply | `[]` | `pending` | `Connecting` + `connecting…` |

Rules that follow from the table:

- The mock roster is reachable from **one** path only: a failing fetch on a board that
  never loaded live. A transient polling error on a working board keeps the live rows and
  stays labelled `Live`; `source.reason` records the error for the badge tooltip.
- An HTTP `200` with a non-array body, invalid JSON, or `!res.ok` is an **error**, not an
  empty roster. `fetchAgentProfilesAsync()` throws `AgentSourceError` for those; a valid
  `[]` is an empty live board and never triggers mock.
- Verified by `node scripts/verify-store.mjs`: every row of the table as a unit test, plus
  source guards that the store boots empty, that `mockEmployees` is not the initial
  roster, and that the HUD renders the `Connecting` label.

---

### 2.2.2 Workspace footprint — `workspaceBytes`

`projection_agents.agent_json.workspacePath` names the agent's own folder under
`~/OpenBot/Agents/agent-<uuid>`. The browser never receives that string; it receives
`workspaceBytes`, an integer or `null`.

| Rule | Value |
| --- | --- |
| Accepted path | absolute and strictly inside `$HOME/OpenBot/Agents/` — the root itself, relatives and `..` are rejected |
| Symlinks | never followed; a folder whose realpath leaves the root is rejected |
| Walk | `readdirSync` + `lstatSync`, regular files only, max `20000` entries, depth ≤ 24 |
| Cache | 60 s per folder, bounded to 64 entries, so the 3 s poll does not re-walk 16 folders |
| Missing | `null` → the info card shows `—`, never a fabricated size |
| Payload | `workspaceBytes` only; `workspacePath` is measured in `src/data/workspaceSize.node.ts` and stays in the process |

Verified by `node scripts/verify-workspace.mjs`: boundary rejects (relative, `/etc`,
`../Secrets`, root), a temp folder proves symlinks are skipped, all 16 live rows carry a
count, and the serialised roster contains neither `workspacePath` nor an absolute Agents
path.

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

### 2.5 Agent avatar — derived, never fetched

OpenBot stores **no avatar image** for an agent. `projection_agents.agent_json` carries
three fields: `avatarSeed` (always set, `/^[a-z0-9:-]{1,128}$/`), `avatarHue`
(sometimes `null`) and `avatarColor` (sometimes `null`). `avatarUrl` exists in the
schema but is `null` on all 16 rows of this machine, so nothing is downloaded today.

| Field | Use in OVO |
|---|---|
| `avatarSeed` | hash input for the face (shape, eyes, hair, accessory) |
| `avatarHue` | tint fallback when `avatarColor` is `null` |
| `avatarColor` | explicit tint, wins over `avatarHue` |
| `avatarUrl` | **not** sent; a remote image would need a server-side proxy plus CSP work |

`src/office/Avatar.ts` is pure (no imports, no DOM): `stableIndex()` is FNV-1a with a
murmur3-style avalanche before the modulo, and `avatarSpec()` returns
`{ tints, shape, expression, hair, accessory }`. `src/components/Avatar.tsx` draws that
as a 12×12 SVG with `shapeRendering="crispEdges"`, so one pixel-art face = one rect
group, size-independent. `scripts/verify-avatar.mjs` covers determinism, variety, tint
resolution, seed sanitising, seed collisions and the contrast table.

**Hash key = `avatarSeed:agentId:<feature>`.** `agentId` participates on purpose: three
agents on this machine share `first-bot:face:123` (Iwa, Neke, Clubo), and hashing the
seed alone gave them one shape, expression, hair and accessory. The avalanche is also
required — raw FNV-1a low bits are weak, so ids differing only near the end collided.

**Tint is a pair, one per theme, measured against two named surfaces.** The face is
painted on the **avatar tile** (`.avatar` background: `--ovo-avatar-tile`, opaque) and
sits inside the **panel gutter** (`.panel.info` background: `--ovo-panel-bg`, blurred over
the page backdrop). They are different colours, and in the light theme the gutter is
*darker* than the tile, so the gutter is the binding surface. The tile is opaque on
purpose — a frosted card behind a translucent tile would put the face on a blur whose
colour depends on the office behind it, and the guaranteed ratio would be void. The gutter
value is the nominal composite of the alpha the CSS paints. `avatarTints()` returns
`{ dark, light }`; hue and saturation stay, lightness is clamped by bisection until the
tint clears **3:1** against both surfaces and the ink (`#14121c`) inside it also clears
**3:1**:

| Theme | Avatar tile (composited) | Panel gutter (composited) | Tint luminance band |
|---|---|---|---|
| dark | `--ovo-avatar-tile` `#1c1621` | `rgba(25,21,32,0.55)` over `#14121c` → `#17141e` | `>= 0.15` |
| light | `--ovo-avatar-tile` `#fbfaf7` | `rgba(250,248,243,0.74)` over `#f4f1ea` → `#f8f6f1` | `0.145 – 0.2395` |

The light ceiling is not hand-tuned: it is `luminanceUnder(gutter, LIGHT_GUTTER_TARGET)`
with `LIGHT_GUTTER_TARGET = 3.08`, so the band cannot drift away from what the UI
paints. Measured on the real 16-agent roster (`node scripts/verify-avatar.mjs`):

| Check | Worst ratio |
|---|---|
| tint on avatar tile, both themes | **3.18:1** |
| tint on panel gutter, both themes | **3.07:1** |
| ink on tint, both themes | **3.43:1** |

The two variants travel to the DOM as CSS custom properties
and `:root[data-theme='light'] .avatar` selects the light one, so a theme switch
repaints without a React re-render. The theme is never read from JS, so no listener
and no listener cleanup is needed here.

The **lists are OVO's**, not OpenBot's: the app's own `SHAPES`/`EXPRESSIONS` arrays are
not readable from its bundle, so the exact silhouette does not match the OpenBot
window pixel for pixel. The same seed + agent id still means the same face in every OVO
client. A missing seed (mock roster, older payload) falls back to the agent id, so no
row is faceless. Raw text cannot reach the DOM: `sanitizeSeed()` folds anything outside
`[a-z0-9:-]` and clips to 128 chars.

**Info card chrome.** `.panel.info` is the same glass as the sidebar: `border-radius: 0`,
`--ovo-panel-bg`, `backdrop-filter: blur(18px) saturate(135%)`, and an opaque
`--ovo-panel-solid` fallback under `@supports not (backdrop-filter)`. It is anchored to the
bottom centre with `left`/`right` insets + `width: fit-content` + `margin-inline: auto`;
on desktop (`.app-shell:has(.hud-sidebar)`, scoped to `min-width: 701px`) the band starts at
`336px` so the card centres in the space the floating sidebar leaves. Desktop is one
horizontal grid row — avatar, `.info-identity`, `.info-facts` `<dl>` — with
`grid-template-columns: auto minmax(0, auto) minmax(0, 1fr)`. At `700px` and below it
collapses to the stacked card, where the `<dl>` spans both columns behind a top hairline.
The four `<dl>` columns are intrinsic (`auto auto auto auto`), so the card grows to its
`max-width: 900px` instead of ellipsing an activity description.

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
renders it defensively: while a phase is `starting` — or `restarting` (order 2), where the provider
is rebooting after an error, a manual restart or a config change — `World.ts` confines that agent to
the Lounge room (`src/office/Lounge.ts`, gate `scripts/verify-lounge.mjs`). It may stand, sit on a
lounge sofa or walk between lounge floor tiles, and never takes a desk, meeting chair or chat spot,
so a `restarting` agent is visibly out of service instead of looking busy at a workstation.

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
| Lounge confinement | `staysInLounge(phase)` → `starting`, `restarting`: goals only from `loungeSeats`/`loungeTiles`, `owesDesk` forced false, no chat/meeting bubble, and the doorway at (14, 13) is never a goal (`src/office/Lounge.ts`) |
| Desk id | `WS-01 … WS-N`, one per agent in roster order (`useStore.ts`, `Layout.ts`) |
| Live caption | `Restarting — walking in Lounge` / `Restarting — waiting in Lounge`, `Starting up — …`, `Blocked — walking to desk` / `Blocked — waiting for your answer`, `Walking to desk — new instruction`, `At desk — reviewing new instruction`, or the status text |

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
db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
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
| `projection_agents` | roster, `sort_order`, `thread_id`, `agent_json` | 16 |
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
6. No DB path, SQL text, credential, raw `agent_json`, or workspace folder path in any
   response body or client log. `workspaceBytes` is the only footprint field that leaves
   the server.
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
3. **`npm run preview` has no API.** It serves static `dist/`, so the fetch fails and the
   client falls back to the mock roster. This is the most common false "it works on my
   machine".
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
curl -s http://127.0.0.1:3000/api/agents | head -c 300
curl -sI http://127.0.0.1:3000/api/agents | grep -i 'content-type\|cache-control'

# guards
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/agents   # 405
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' \
  http://127.0.0.1:3000/api/agents                                                   # 421

# source gate (types, schema, phase rules, bundle hygiene)
node --import ./scripts/register-ts.mjs scripts/verify-openbot-source.mjs

# source gate (types, schema, phase rules, bundle hygiene)
node --import ./scripts/register-ts.mjs scripts/verify-openbot-source.mjs

# all gates at once
npm run verify

# single gate, when one is enough
node --import ./scripts/register-ts.mjs scripts/verify-store.mjs          # pending/openbot/mock transitions + boot state
node --import ./scripts/register-ts.mjs scripts/verify-avatar.mjs         # tint contrast on avatar tile AND panel gutter, 16 × 2
node --import ./scripts/register-ts.mjs scripts/verify-workspace.mjs      # folder-size walker boundary + symlink skip + no path leak

# raw DB truth, read-only
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT COUNT(*) FROM projection_agents;"
sqlite3 "file:$HOME/Library/Application Support/OpenBot/openbot.db?mode=ro" \
  "SELECT agent_id, MAX(occurred_at) FROM agent_usage_activity GROUP BY agent_id;"
```
