# OpenBot Virtual Office (OVO)

<img src="public/logo.png" alt="OpenBot Virtual Office (OVO) logo" width="160">

<!-- Badges built with https://github.com/ileriayo/markdown-badges (shields.io) -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge&logo=open-source-initiative&logoColor=white)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933.svg?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?style=for-the-badge&logo=react&logoColor=black)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](package.json)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)](package.json)
[![PixiJS](https://img.shields.io/badge/PixiJS-8-FF4DB8.svg?style=for-the-badge&logo=pixijs&logoColor=white)](package.json)
[![Zustand](https://img.shields.io/badge/Zustand-5-2D3748.svg?style=for-the-badge)](package.json)
[![SQLite: read-only](https://img.shields.io/badge/SQLite-read--only-003B57.svg?style=for-the-badge&logo=sqlite&logoColor=white)](docs/OPENBOT_OFFICE_API.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](#license)

**OpenBot Virtual Office** — **OVO** for short — is a *visualisation* of the work running inside
OpenBot, rendered as a 2D pixel-art virtual office. Its role is **observe only**: OVO has no chat, no
command box, and cannot send instructions to an agent. Instructions stay in OpenBot itself; OVO shows
the consequences — who is working, who is idle, who is waiting for an answer, and who has unread
messages.

An open-plan office world in an *Elevated Top-Down Orthographic* style that you can pan and zoom.
Every asset is generated programmatically (no external image files).

The office canvas fills the viewport; the sidebar is a **floating panel** laid over it —
fixed with a 16 px gap from the top, left and bottom edges, an all-round 1 px border and a
layered drop shadow, and square corners throughout (matching the pixel look). No layout space is
reserved for it, so hiding the sidebar leaves the canvas exactly as it was.

The panel is **frosted glass**: `rgba(25, 21, 32, 0.55)` over
`backdrop-filter: blur(20px) saturate(135%)`, so the office reads through it while the text keeps
its contrast. Inner cards, notices and the font picker use thinner translucent layers instead of
opaque fills, and the reopen handle gets the same treatment. Browsers without `backdrop-filter`
fall back to `rgba(25, 21, 32, 0.94)` via `@supports not (...)`, so the panel never turns into
translucent text over sprites.

**Team activity** lists one row per phase with its count. Clicking a non-empty row expands the
agents in that phase (alphabetical, real `name` from the roster); clicking a name focuses that agent
in the office and opens its info panel. Empty phases are disabled — nothing to list.

The data is **not mock**: the app reads OpenBot's SQLite database **read-only** through
`GET /api/agents` and renders each agent's `phase` + `activity`. The mock roster is a
**last resort**: the board opens empty with a grey `Connecting` badge, fills from the
first successful fetch, and only falls back to mock when a fetch actually fails on a board
that never loaded live. A polling error on a working board keeps the last live snapshot.

Start here: [`docs/OPENBOT_OFFICE_API.md`](docs/OPENBOT_OFFICE_API.md) (data contract),
[`docs/OPENBOT_OFFICE_RUNTIME.md`](docs/OPENBOT_OFFICE_RUNTIME.md) (runtime & operations),
[`docs/OpenBot-OFFICE-API-GUIDE.md`](docs/OpenBot-OFFICE-API-GUIDE.md) (implementation map).

## Integration with OpenBot

<img src="https://avatars.githubusercontent.com/u/100160810?s=60&v=4" alt="nightly-labs logo" width="28">

OVO is a companion viewer for **[OpenBot](https://github.com/nightly-labs/openbot)** — the local-first
desktop workspace for persistent AI teammates, built by
**[nightly-labs](https://github.com/nightly-labs)** ([openbot.run](https://openbot.run/)). OpenBot does
the work: it runs the agents, their workspaces, the task queue and the conversation. OVO never
duplicates that — it only **reads** the SQLite database OpenBot already writes (a handful of tables
per request, `readonly: true`, no writes, no calls back into OpenBot) and turns the result into a room
you can watch.

> **This is not the CopilotKit project.** OVO integrates with `nightly-labs/openbot`. It is unrelated
> to [`CopilotKit/OpenBot`](https://github.com/CopilotKit/openbot) ([open.bot](https://open.bot)), a
> different product from CopilotKit. Both happen to share the name "OpenBot"; only
> `nightly-labs/openbot` is the application this office visualises.

## Prerequisites

- **Node.js 20+** (tested on Node 24) and npm.
- OpenBot installed on the same machine, because OVO reads OpenBot's `openbot.db` in read-only mode.
  Default per-OS locations are listed in
  [`docs/OPENBOT_OFFICE_RUNTIME.md`](docs/OPENBOT_OFFICE_RUNTIME.md); override with
  `OPENBOT_DB_PATH`.
- Without OpenBot/DB the app still runs, but falls back to mock data (source badge in the sidebar).
  The mock roster is shown only after a fetch fails; before the first reply the badge reads
  `Connecting` and the list is empty.

## Running
```bash
npm install
npm run dev      # http://localhost:5173  (the only mode that has /api/agents)
npm run build    # type-check + production build into dist/
npm run preview  # static dist/ — NO API, the UI falls back to mock

node scripts/verify-monitor.mjs        # phase × seated matrix + monitor source guards
node scripts/verify-openbot-source.mjs # check the SQL queries stay read-only
node scripts/verify-lounge.mjs         # `starting`/`restarting` agents stay inside the Lounge room
node scripts/verify-store.mjs          # roster source states: never mock before a failed fetch
node scripts/verify-workspace.mjs      # workspace-folder size walker + no path leak to the browser
node --import ./scripts/register-ts.mjs scripts/verify-chairs.mjs  # chair collision + meeting-room chat
node --import ./scripts/register-ts.mjs scripts/verify-rooms.mjs  # pantry spacing, NOC server-room dressing, carpet
node --import ./scripts/register-ts.mjs scripts/verify-idle.mjs  # standby agents sit and chat in the social rooms
node scripts/verify-labels.mjs         # agent name plate + status dot size and seated height
```

`npm run preview` and any other static host do not serve `/api/agents`: the request falls through to
`index.html` with status `200`. Check `Content-Type`, do not trust the status code alone.

## Controls
WASD / arrow keys / drag = camera · scroll or `+`/`-` = zoom (`0.70x`–`3x`, starts at `0.75x`) · click a
character **or its workstation computer** = info panel · `E` = randomise simulation status · `Esc` = close panel.

URL `?props=<n>` scales props by `n` (0.5–4, default `2`); the floor, glass partitions and doors stay on the tile grid so nothing overshoots. A door opening is `DOOR_SPAN` tiles wide (`src/constants.ts`, 3) and its leaf is one sprite centred on the opening.

### Rooms
| Room | Walls | Interior | Door |
|---|---|---|---|
| Meeting | column 17 and column 32 (rows 5–19), row 20 | columns 18–31, rows 6–19 | 3-tile opening in column 32, rows 10–12, facing the 3-tile aisle (33–35) before the first desk bay |

The Meeting Room sits one room-width left of the workstation block. Its interior is laid out in pixels so each prop keeps a margin from the glass at 2×: a 3-seat sofa and the 64×52 whiteboard along the top band, an 8-seat table under them, a 10×8 rug beneath the whole bay, and a plant in each bottom corner. The floor runs two rows past the rug (rows 18–19) so the carpet stops clear of the bottom glass, which now sits on row 20 with both side partitions (columns 17 and 32) extended down to meet it. The whiteboard sits at the right end of the top band (x 872–1000, 4 tiles), 88 px clear of the sofa and hung 12 px above its base line, so the pair read as one wall band without covering each other.

## Architecture
| File | Role |
|---|---|
| `src/office/AssetGenerator.ts` | All pixel art (floor, walls, windows + day/night skyline, glass partitions, furniture, lit/unlit monitors, 4-direction characters + walk/sit frames, speech bubble) is drawn on a Canvas 2D → `Texture` (filter `nearest`). One pixel-art pixel = 2 screen px on the floor, glass partitions, doors and the whiteboard (64×52 art px, 4 tiles wide), and 4 screen px (2×) on the other props: desks, racks, plants, characters. Monitors are drawn one step above that (`MONITOR_SCALE = PROP × 1.25`, anchored bottom-centre) so the screen covers about 2.5 of its 4-tile desk without towering over it; `MONITOR_W`/`MONITOR_H` in `World.ts` keep the click area on the drawn size. `?props=1` restores the 1× prop size; `?props=` takes 0.5–4. |
| `src/office/Layout.ts` | Room layout (Lounge, Meeting, Workstation, Pantry/Storage in the upper-left room, NOC with 2 racks in a single row in the lower-left room), collision grid, seat and chat-spot lists. Desk count `buildLayout(deskCount)` follows the agent roster, clamped to 12–16, seats `WS-01…WS-N`. The Meeting Room takes columns 17–32 (interior 18–31, rows 6–19, closed by a wall row at 20) with a 3-tile door in its right wall at rows 10–12; workstation bays start on column 37 and sit on a 6-tile column pitch (4-tile desk + 2-tile aisle on the right of each bay) with a 6-tile row pitch, first row at tile row 9, clear of the window band and one tile short of the right wall. `DESK_W = max(2, round(32 × PROP / TILE))` blocks the desk's full sprite width (4 tiles at the 2× default, 2 at `?props=1`), so a walker only crosses a bay through an aisle, never over the desk. A workstation is desk + monitor + chair only — there is no filing cabinet sprite on the bay. Chairs whose seat faces `up` (workstation, the table's near side, the dining nook) are placed with `chair(..., front = true)`, which lifts their `z` above the sitting agent so the backrest overlaps the body and the agent reads as seated. `chair()` also writes the collision footprint: a chair sprite is 2 tiles wide at the 2× scale, so its seat row is `block(tx-1, ty, 2, 1)` and a walker routes around the backrest instead of through it. The seat tile therefore stays reserved for its occupant, and every seat's `approach` tile sits one row outside the chair (workstation `ty + 2`, meeting table rows 9 and 16, dining nook rows 22 and 27). A sofa seat instead carries `zOffset` (`8` on the down-facing 3-seat sofas so the sitter draws in front of the backrest, `0` on the up-facing loveseats where the backrest is nearest the viewer). |
| `src/office/Pathfinder.ts` | BFS over the tile grid so characters walk around furniture. |
| `src/office/Character.ts` | Sprite, idle/walk/sit animations plus typing variants and speech bubble, name label, status indicator. |
| `src/office/Monitor.ts` | Pure `monitorStateFor(phase, seated)` → `off`/`still`/`moving`/`waiting`: the "seated first, then lit" gate, used by `World.ts` and covered by `scripts/verify-monitor.mjs`. `waiting` is the grey screen a seated `blocked` agent waits behind. |
| `src/office/Lounge.ts` | Pure Lounge box (`LOUNGE_ROOM`, `isInLounge`) plus the phase rule `staysInLounge(phase)` — `starting` and `restarting`. Imports nothing, so `scripts/verify-lounge.mjs` runs it directly with `node`. |
| `src/office/Idle.ts` | Pure standby rule: `isSocialZone()` (Lounge, Pantry & Storage, Meeting Area), `pickIdleSeat()` (a free non-desk chair, preferring one whose vis-à-vis is already seated), `pickIdleTile()`, `isChattingSeat()` and `visAVis()`. Type-only imports, so `scripts/verify-idle.mjs` runs it with `node`. `World.ts` builds its idle floor-tile pool from the same zone list, which is why a standby agent can never pick a workstation aisle. |
| `src/office/Avatar.ts` | Pure avatar recipe: `stableIndex()` (FNV-1a + murmur3 avalanche) and `avatarSpec()` turn `avatarSeed` plus `agentId` and `avatarHue`/`avatarColor` into `{ tints, shape, expression, hair, accessory }`. Tints are clamped per theme for 3:1 contrast. No imports, no DOM, so `scripts/verify-avatar.mjs` runs it with `node`. |
| `src/office/World.ts` | Pixi scene, Y-sorting (`zIndex` = bottom edge of an object), camera + bounds, input, agent placement: `working`/`ready` sit at a desk, agents with unread/waiting walk to their own desk. An agent in `starting` or `restarting` is confined to the Lounge room — it sits on a lounge sofa or stands/walks between lounge floor tiles, takes no desk, meeting chair or chat spot, and a pending instruction cannot pull it out. `updateMonitors()` lights a desk screen only when the agent is genuinely seated on that chair (`seat.occupant` **and** `Character.state === 'sit'` on the same `seat`) with `phase` `working`/`ready`/`blocked`; `working` uses animated frames, `ready` a still frame, `blocked` the grey waiting frame while the human answers. A `blocked` agent stays at that desk and stops typing until the phase moves on. A chair is already reserved the moment an agent starts walking, so `seat.occupant` alone is not enough — the screen stays dark while the agent is still walking. |
| `src/store/useStore.ts` | Zustand: employees derived from the API, selection, notifications, UI settings, 3 s polling loop. Boots empty with `source: 'pending'`, never with the mock roster. |
| `src/store/sourcePolicy.ts` | Pure roster-source policy: `resolveSource()` maps each fetch outcome to `{ employees, source }`. Starts `pending`, fills `openbot`, falls back to `mock` only when a fetch fails with no live snapshot to keep. No runtime imports, so `scripts/verify-store.mjs` runs it with `node`. |
| `src/data/openbotSource.node.ts` | Node side: opens SQLite `readonly`, 11 queries, derives `phase` + `activity`. |
| `src/data/workspaceSize.node.ts` | Measures an agent workspace folder from `<Agents>/…` only: no symlinks, 20 000-entry budget, 60 s cache. Returns bytes; the path stays in the process. |
| `src/data/openbotSource.ts` | Type contract + Zod `agentProfileSchema` + fetch client. |
| `vite-plugin-openbot.ts` | Dev-only middleware: `GET /api/agents` (Host/method guards, security headers, strips `provider`/`model`/`threadId`), `GET /api/office-logo` streaming the workspace logo from OpenBot's app-support folder (`204` when none), and `GET /api/office-profile` returning the OpenBot profile name as JSON. |
| `src/components/*` | HUD, character info panel, canvas host (React overlay on top of Pixi). |

## Phases and activity
Two independent signals describe an agent, and both are re-read from `openbot.db` on every request
(`src/data/openbotSource.node.ts`):

- **`phase`** — what the runtime is doing right now. It decides *where* the character is and what its
  desk screen shows.
- **`activity`** — the single highest-priority event attached to that agent. It is the note printed
  beside the phase label (`CharacterInfo.tsx` → `badge.note`), and for `waiting`/`unread` it is also
  the reason the agent owes its desk a visit.

The phase is never read off the activity list: both are derived separately, which is why one phase
can carry different notes. The desk screen follows `Monitor.ts`, so it only changes while the agent
is genuinely seated on that chair.

### Activity kinds
| Activity | Weight | Produced when | Variant | Note in the UI | Office effect |
| --- | --- | --- | --- | --- | --- |
| `waiting` | 100 | at least one `agent_waits` row with `woken_at IS NULL` | `question` | Waiting | Always alongside `blocked`: pulls the agent to its own desk |
| `limited` | 90 | *not implemented* — no query produces it yet | — | Limited | None today; usage limits would come from OpenBot's own limit state |
| `unread` | 80 | messages with a higher ordinal than the read cursor | message count | Unread | `owesDesk` turns true: walks to its own desk and reviews it |
| `responded` | 60 | `agent_usage_activity` inside `STATUS_WINDOW_MS` (90 s) | `assistant` | Replied just now | None on its own — the same evidence already makes the phase `working` |
| `routine` | 40 | *not implemented* — no query produces it yet | — | Routine | None today |
| `working` | 20 | non-null `projection_threads.active_turn_id` | `turn` | Working on turn | None beyond the phase; `working` already seats the agent |

Highest weight wins, ties break on kind name so the output is stable. `limited` and `routine` keep
their weight and label so a future query can emit them without touching the UI. Activity only ever
changes text: the indicator dot is always `PHASE_COLORS[phase]`.

### Phases
Windows that decide a phase: `STATUS_WINDOW_MS` 90 s (recent turn / usage / delivery),
`READY_WINDOW_MS` 10 min (the session is still moving), `SESSION_STALE_MS` 30 min (grace before an
active session is demoted), `RESTART_WINDOW_MS` 5 min (a restart marker is fresh).

| Phase | Trigger | What the agent does | Desk screen | Typing | Live caption |
| --- | --- | --- | --- | --- | --- |
| `working` | non-null `active_turn_id`, or turn / usage / delivery inside 90 s | Sits at its own desk `WS-NN` and works | Moving (4 frames, 220 ms) | Yes | `Working at WS-NN` |
| `ready` | session `active` **and** (session moved < 10 min **or** traffic < 30 min) | Sits at its own desk, powered on and waiting | Still, lit | No | `Working at WS-NN` |
| `blocked` | at least one unwoken `agent_waits` row | Leaves whatever it was doing, walks to its own desk and stays seated; its activity is always `waiting` | Grey with pause bars | No | `Blocked — walking to desk` / `Blocked — waiting for your answer` |
| `restarting` | `%restart%` thread activity inside 5 min | Penned in the **Lounge**: sits on a sofa or stands/walks between lounge floor tiles; takes no desk, meeting chair or chat spot | Dark | No | `Restarting — walking in Lounge` / `Restarting — waiting in Lounge` |
| `idle` | a session row exists but no fresh evidence | Follows the simulation `Status`, but a standby agent sits and chats in the Meeting Area, Lounge or Pantry instead of roaming. If the activity is `unread` or `waiting` it still walks to its own desk and reads there | Dark | Only at the desk for a pending instruction | `Standing by in <room>`, or `Walking to desk — new instruction` / `At desk — reviewing new instruction` |
| `starting` | never produced today (`AGENT_PHASES` only) | Same Lounge pen as `restarting`, if it ever appears | Dark | No | `Starting up — walking in Lounge` / `Starting up — waiting in Lounge` |
| `stopped` | no session row at all | Follows the simulation `Status`: wanders, chats, takes a break | Dark | No | `Wandering the office` |

Two consequences worth naming:

- A `starting`/`restarting` agent is penned: `owedDesk()` returns false for it, so even a `waiting`
  activity cannot pull it out of the Lounge. It leaves the room only when the phase changes.
- `blocked` outranks everything except `waiting` itself (they are the same evidence), so an agent
  that is both restarting and waiting on a human shows `blocked`, not `restarting`.

### What each phase does per activity
The two layers meet in `World.assign()`: the phase decides the room (Lounge pen, or the normal
floor), and only then does the activity decide whether the agent owes its desk a visit. The table
below is that interaction, cell by cell. "Note only" means the note beside the phase label changes
and nothing else moves.

| Phase | `waiting` (100) | `unread` (80) | `responded` (60) | `working` (20) | `limited` (90) / `routine` (40) |
| --- | --- | --- | --- | --- | --- |
| `working` | Cannot show — the same row makes the phase `blocked` | Note only: already seated at its desk, screen scrolling, typing | Note only: this usage row is also the evidence that made the phase `working` | Note only: the active turn is the evidence that made the phase `working` | Note only |
| `ready` | Cannot show — the phase becomes `blocked` | Walks to its own desk and types the review; the screen keeps the still `ready` image | Cannot co-occur — recent usage forces `working` | Cannot co-occur — an active turn forces `working` | Note only |
| `blocked` | The cause: walks to its own desk, sits, no typing, grey screen | Never surfaces — `waiting` weighs more | Never surfaces — `waiting` weighs more | Never surfaces — `waiting` weighs more | Never surfaces — `waiting` weighs more |
| `idle` | Cannot show — the phase becomes `blocked` | Walks to its own desk and types; the screen stays dark | Cannot co-occur — recent usage forces `working` | Cannot co-occur — an active turn forces `working` | Note only |
| `stopped` | Cannot show — the phase becomes `blocked` | Walks to its own desk and types; the screen stays dark | Cannot co-occur — no session, no usage | Cannot co-occur — no session, no turn | Note only |
| `starting` / `restarting` | Ignored — penned in the Lounge, no desk visit | Ignored — penned in the Lounge, no desk visit | Ignored | Ignored | Ignored |

- The pen is checked before the desk: `assign()` calls `assignLounge()` and returns for a
  `starting`/`restarting` agent, so no activity can move it out of the room.
- Everywhere else a desk is granted to `status === 'working'` **or** `owedDesk()`, which is
  `unreadCount > 0 || activity.kind === 'unread' || 'waiting'`. That is why `unread` is the only
  activity that changes a body's position without changing its phase.
- The indicator dot is always `PHASE_COLORS[phase]`; activity never tints it.
- The `limited` / `routine` column is a placeholder: no query emits those kinds yet, so real agents
  only ever arrive with the other four.

## Typography
The sidebar font is a theme picked in **Settings → Sidebar font**, with two options:

| Value | Typeface | Notes |
| --- | --- | --- |
| `mono` (default) | `ui-monospace, Menlo, Consolas, monospace` | The plain monospace the project shipped with; no download. |
| `pixel` | **Geist Pixel** | Self-hosted, pixel feel. |

The choice is held in memory by the store (`sidebarFont`) and applied as
`<aside class="hud-sidebar" data-font="mono|pixel">`; CSS keys everything off `[data-font='pixel']`.
Like every other UI toggle in this app, it resets on reload — OVO stores nothing.

Geist Pixel is self-hosted from `public/fonts/` (`geist-pixel-latin-400.woff2`,
`geist-pixel-latin-ext-400.woff2`), so the app makes no request to `fonts.googleapis.com` and keeps
working offline. Only the single 400 cut Google Fonts publishes is shipped (latin + latin-ext
subsets), and pixel mode sets `font-synthesis: none`, so heavy text is differentiated by size and
letterspacing instead of a faux-bold. The two badges step up one pixel in pixel mode
(`.live-badge` 8→9px, `.source-badge` 9→10px) because the pixel cut reads thinner. Two deliberate
exceptions:

- `.sidebar-controls` stays `ui-monospace` in both modes: the arrow glyphs (`↑↓←→`) have no pixel
  cut and would otherwise mix two typefaces on one line.
- Text the browser paints outside the canvas (names in the 3D scene, HUD chips on the canvas) is
  not part of the sidebar.

Licence: SIL Open Font License 1.1, `Copyright 2026 The Geist Project Authors`
(<https://github.com/vercel/geist-font>); the full text ships as `public/fonts/OFL.txt`.

## Theme
The UI chrome has three modes, picked in **Settings → Theme**:

| Value | Behaviour |
| --- | --- |
| `system` (default) | Follows the OS `prefers-color-scheme`, and keeps following it live — changing the system appearance repaints OVO without a reload. |
| `light` | Pins the light palette, whatever the OS says. |
| `dark` | Pins the dark palette, whatever the OS says. |

The palette is a set of CSS custom properties in `src/styles/index.css`: dark values on `:root`
(the defaults), light values in `:root[data-theme='light']`. Every sidebar, info-panel, button,
select and modal colour reads a `--ovo-*` variable, so both palettes come from one stylesheet.
`color-scheme` is set alongside each palette so native widgets (select popups, scrollbars) follow.

`src/theme.ts` only decides which palette is active: `resolveTheme()` maps the mode to `light` or
`dark`, and `applyTheme()` writes two attributes on `<html>` — `data-theme` (the resolved palette)
and `data-theme-mode` (what the user picked). While the mode is `system`, `watchSystemTheme()`
subscribes to the `prefers-color-scheme: light` media query and re-applies on change. The choice
lives in the store as `themeMode` and is applied by an effect in `App.tsx`; like every other UI
toggle it resets on reload, because OVO stores nothing.

Two details worth knowing:

- The canvas office art is **not** themed. It is pixel art drawn once into textures, so it keeps its
  own day/night look; the light palette is a warm paper tone (`--ovo-bg: #f4f1ea`) chosen so the
  frosted sidebar still reads as an overlay on top of that unchanged scene.
- `index.html` carries a small inline script that sets `data-theme` from the OS **before** React
  mounts, so a light desktop never flashes the dark defaults. It is kept in sync with `src/theme.ts`
  by hand, and its `theme-color` metas are split per `prefers-color-scheme` for the browser UI.

## Avatars
The info panel draws each agent's face from its **seed**, not from a picture. OpenBot keeps no
avatar image in `openbot.db`: `projection_agents.agent_json` carries `avatarSeed` (always set),
`avatarHue` and `avatarColor` (sometimes `null`), and those three alone decide the face.

`src/office/Avatar.ts` is the whole recipe and imports nothing. `stableIndex()` is FNV-1a over
the key, then a murmur3-style avalanche before the modulo. The key is
`avatarSeed:agentId:<feature>` — `agentId` is hashed in on purpose, because three agents on
this machine share the seed `first-bot:face:123` and would otherwise get one identical face.
The avalanche matters too: raw FNV-1a has weak low bits, so ids differing only at the end
collided. `avatarTint()` prefers `avatarColor`, then the palette entry for `avatarHue`, then a
hex `hsl()` fallback. `sanitizeSeed()` folds anything outside `[a-z0-9:-]` and clips to 128
chars, so a bad row cannot break the hash or reach the DOM raw.

**Contrast is guaranteed, per theme, against two named surfaces.** The face is painted on the
**avatar tile** (`--ovo-avatar-tile`) and sits inside the **panel gutter** (`--ovo-panel-bg`,
blurred over the page). Those are not the same colour, and in the light theme the gutter is the
*darker* of the two, so it is the surface that binds:

| Theme | Avatar tile | Panel gutter |
|---|---|---|
| dark | `--ovo-avatar-tile` `#1c1621` (opaque) | `rgba(25,21,32,0.55)` over `#14121c` → `#17141e` |
| light | `--ovo-avatar-tile` `#fbfaf7` (opaque) | `rgba(250,248,243,0.74)` over `#f4f1ea` → `#f8f6f1` |

The tile is deliberately **opaque**: the info card is frosted glass, so a translucent tile would
put the face on a backdrop blur whose colour depends on whatever the office paints behind it, and
the guaranteed ratio would be void. The gutter value is the nominal composite of the same alpha
the CSS paints, which is what the tint clamp is measured against.

`avatarTints()` returns two variants of the same hue. The dark variant is lifted in HSL lightness
until it reaches 3:1; the light variant is clamped to a luminance ceiling derived from the gutter
(`LIGHT_GUTTER_TARGET = 3.08`) so it clears the 3:1 floor on **both** surfaces *and* keeps the ink
`#14121c` at 3:1 inside the tile. Hue and saturation are kept, so Neke stays yellow and Clubo stays
sky blue — only lightness moves. Worst case on the real 16-agent roster:

| Surface | Worst ratio |
|---|---|
| tint on avatar tile | 3.18:1 |
| tint on panel gutter | 3.07:1 |
| ink on tint | 3.43:1 |

`scripts/verify-avatar.mjs` prints a ratio column for each surface separately, so a report can say
which one it measured.

### Info card chrome
The card is square-cornered glass like the sidebar: `border-radius: 0`, `--ovo-panel-bg`,
`backdrop-filter: blur(18px) saturate(135%)`, and an opaque `--ovo-panel-solid` fallback under
`@supports not (backdrop-filter)`. It is anchored to the bottom centre — `left`/`right` insets plus
`width: fit-content` and `margin-inline: auto` — and on desktop the band starts at `336px` so it
centres in the space the floating sidebar leaves; that override is scoped to `min-width: 701px`, so
the mobile card keeps its plain 8px insets and never slides off the right edge. Desktop is one
horizontal row (avatar · identity · facts); at `700px` and below it collapses to the stacked card,
with the `<dl>` spanning both columns behind a top hairline.

`src/components/Avatar.tsx` draws that spec as a 12×12 SVG with `shapeRendering="crispEdges"`:
crisp at any size, zero network requests, zero new dependencies. The two tints arrive as CSS
custom properties (`--avatar-tint-dark`, `--avatar-tint-light`) and `:root[data-theme='light']
.avatar` picks the active one, so a theme switch repaints the face without a re-render. A row
with no seed (mock roster, older payload) falls back to the agent id, so no character is
faceless.

### Workspace footprint
Each agent has its own folder at `~/OpenBot/Agents/agent-<uuid>`, so the info card shows how much
disk that agent actually holds. Clicking the agent **or its workstation computer** opens the same
card, and the `Disk` row is that folder's total size (`4.2 MB`, `33 MB`).

The number is measured server-side, in `src/data/workspaceSize.node.ts`, from
`projection_agents.agent_json.workspacePath`. That path never reaches the browser: `/api/agents`
forwards only `workspaceBytes`, an integer or `null`. The walk is read-only and bounded — absolute
folders strictly inside `$HOME/OpenBot/Agents/` only, no symlinks followed, 20 000 entries max,
depth ≤ 24, 60 s cache so the 3 s poll does not re-walk 16 folders. A missing folder yields `null`
and the card prints `—` rather than a guess. `scripts/verify-workspace.mjs` covers the boundary,
the symlink skip and the no-path-leak guarantee.

The office doesn't multiplex the shared state: `openbot.db` (event log, messages, provider history)
is not attributable to one agent folder, so the card reports the workspace folder only and says so.

The feature lists are OVO's own: OpenBot's sprite order is not readable from its bundle, so the
silhouette is similar in spirit but not identical to the OpenBot window. Nothing is copied from
its `forme-*.webp` assets. `avatarUrl` is not used yet; a remote image would need a server-side
proxy and CSP work, and it can point at personal photos.

## Ground rules
- **Name**: OpenBot Virtual Office, **OVO** for short.
- **Purpose**: a 2D pixel-art visualisation of the work already happening in OpenBot — not a work app.
- **Boundary**: no chat, no instructions, no task submission. Instructions are written in OpenBot.
- **Data source**: OpenBot's `openbot.db`, opened with `readonly: true`, `fileMustExist: true`.
- **No storage of its own**: no database, no persistence, state lives in browser memory only.
- **Truth**: the code is the source of truth; the docs describe the code that exists, and designs
  that are not built yet are clearly marked *not implemented*.
- **Supported mode**: the Vite dev server (`npm run dev`) — the only mode with `/api/agents`.

## Notes
- **Identity & boundary**: OVO = OpenBot Virtual Office, a 2D pixel-art visualisation of OpenBot work.
  It is not a control surface: no chat, no instruction box, no way to send a task from the office. The
  only I/O to the server is read-only: `GET /api/agents` for the agent snapshot and
  `GET /api/office-logo` for the workspace logo bytes and `GET /api/office-profile` for
  the OpenBot profile name (`grep 'fetch(' src` = 3 hits, no `POST`).
- Perspective: horizontal/vertical grid, no vanishing point; depth comes from Y-sorting only.
- Lounge (upper-left room, rows 6–15): a 6-tile three-seat sofa one row off the window band (cols 4–9, row 8), a 4×2 coffee table centred under it (cols 5–8, rows 10–11), and a 4-tile loveseat on each side facing up (cols 1–4 and 10–13, row 13), so the three pieces ring the table without overlapping sprites. A 10×6 rug sits under the bay, a tall plant flanks each side of the sofa on row 8, and rows 9 and 14 stay open wall to wall so every seat is reachable from the door on rows 10–12. Seven lounge seats (`LS-1/3/5`, `LL-1/3`, `LR-1/3`).
- Pantry & Storage (upper-left room, rows 17–29): three shelf clusters on row 20 (two tiles below the top wall) with a one-tile gutter at col 5 and col 10 (bookshelf 4 tiles, cabinet, fridge and dispenser 2 tiles each), a 4-tile `diningTable` with two chairs per long side on the 7×6 rug at rows 22–27 (chairs centred at x 192 and 256, one 2-tile sprite apart so nothing overlaps, approach rows 22 and 27), and a plant in each bottom corner. Footprint widths follow the art at the 2× prop scale, and `place()`/`block()` now reject fractional tiles.
- Sofa sitters: a seat on the down-facing 3-seat sofas (Lounge and Meeting Area) carries `zOffset = 8`, so the body sorts **in front of** the sofa sprite. Without it the backrest overdraws the torso and only the head shows above it, which reads as the agent sitting the wrong way round. The up-facing loveseats keep `zOffset = 0` because their backrest sits between the viewer and the sitter.
- NOC (lower-left room, rows 31–38): raised-floor access panels (every other panel perforated for cold-aisle airflow) drawn into the floor texture inside a clip rectangle measured on the partition faces, not on whole tiles: x 0–228 art px (the col-14 pane is 8 art px wide and centred, so its room-side face is 4 art px inside the tile line) and y 484–640 art px (row-30 pane bottom face, then the last floor row). That leaves no bare floor strip on the left or right edge and no carpet past the glass, two racks with four server units each at row 36, a louvered CRAC and a UPS cabinet beside them, and two patch panels (access switches) on the wall row 31. Every tall prop is based on row 36 so it grows upward to row 32 and never clips the pantry wall, and two walk lanes stay open.
- Agent name plate: 12 px bold on a 19 px pill with an r4 status dot, so the label stays readable at the shipped 2× prop scale. A `ready`/`working` agent sitting at a workstation carries the plate **under its chair** (`BELOW_CHAIR = -10` art px: plate centre 20 screen px below the feet at 2×, about 8 px clear of the chair's bottom edge) instead of over the head, where it covered the monitor and the seated sprite; the speech bubble cancels the drop so it still leaves the head clear. Any other pose keeps the plate above the agent — social seats at 52 art px, standing and walking at 64 art px — so the plate lifts back up as soon as the agent stands, and a blocked/idle sitter is unchanged.
- Room plates (`ROOM_LABELS` in `Layout.ts`): each is 14 px tall and centred on its tile, so `ensureRoomLabelsClear()` only checks that one row — a plate may sit on the bottom row of a rug even when the table or a plant occupies the row above. Positions: WORKSTATIONS on row 6 (directly under the window band, centred on the third window), PANTRY & STORAGE on row 27 (bottom rug row), MEETING ROOM on row 17 (bottom rug row), NOC on (7,33) in the open lane between the rack sprites (end x 192) and the CRAC (starts x 256). `roomLabelLayer` is added **after** `sortLayer`, so no plate can be hidden behind a tall prop.
- Simulated positions move on their own every ±20–45 s (working → desk, meeting → meeting area
  chair, break → a chair in the Meeting Area, the Lounge or the Pantry, chat → a meeting-table chair
  facing a colleague or an aisle chat spot when every chair is taken, idle → a chair in one of those
  three social rooms). A standby (`idle`) agent picks a chair whose vis-à-vis is already seated when
  one is free, otherwise any free social chair, and only falls back to a social-room floor tile when
  all 21 chairs are taken — its goals come from `src/office/Idle.ts` and the social-room tile list, so
  it never paces the workstation aisles. A seated idle agent keeps its chair for 18–40 s
  (`Math.random() < 0.6` = stay put) and shows a talk bubble when somebody sits facing it, so two
  standby agents read as a conversation. This is simulation `Status`, separate from the real agent
  `phase`, so the office stays alive when the database cannot be read.
- A desk monitor lights up only if the agent is **already seated** on that chair (state `sit` on the
  same `seat`) and its `phase` is `working`, `ready` or `blocked`. The chair is reserved from the
  moment the agent starts walking, so an agent still walking to its desk = screen stays dark.
  `working` = screen **moving** (4 frames, code rows scroll one pixel per frame, caret moves, swap
  every 220 ms); `ready` = screen **still**; `blocked` = screen **grey with pause bars**, because the
  agent is parked in front of the computer until a human answers its prompt/approval or the usage
  limit resets — it stays there and starts typing again the moment the phase moves on.
  `idle`/`restarting`/`stopped` = dark screen
  (`World.ts` → `updateMonitors`, `AssetGenerator.ts` → `makeMonitor(mode, frame?)`).
- `phase` is recomputed from the database on every request. An agent with no traffic for > 30 minutes
  drops to `idle` (Standby) — a quiet board is correct, not a bug.
- Canvas window scenery follows the local clock (night 18:00–06:00); this is pixel art, unrelated to
  the UI **Settings → Theme** mode.
- Size/speed/colour constants live in `src/constants.ts`, including `DOOR_SPAN` (door opening in tiles, 3) and `PROP_SCALE` (`?props=` default 2).
- `dist/` is immutable per build; never edit build output, rebuild instead.

## License

MIT — see [`LICENSE`](LICENSE). © 2026 Abe Wisnu.
