# OVO — Avatars & Info Panel

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

## Info Card Chrome

The card is square-cornered glass like the sidebar: `border-radius: 0`, `--ovo-panel-bg`,
`backdrop-filter: blur(18px) saturate(135%)`, and an opaque `--ovo-panel-solid` fallback under
`@supports not (backdrop-filter)`. It is anchored to the bottom centre — `left`/`right` insets plus
`width: fit-content` and `margin-inline: auto` — and on desktop the band starts at `336px` so it
centres in the space the floating sidebar leaves; that override is scoped to `min-width: 701px`, so
the mobile card keeps its plain 8px insets and never slides off the right edge. Desktop is one
horizontal row (avatar · identity · facts), including a `Follow` toggle next to the phase badge to
keep the camera centred on the selected agent; at `700px` and below it collapses to the stacked card,
with the `<dl>` spanning both columns behind a top hairline.

`src/components/Avatar.tsx` draws that spec as a 12×12 SVG with `shapeRendering="crispEdges"`:
crisp at any size, zero network requests, zero new dependencies. The two tints arrive as CSS
custom properties (`--avatar-tint-dark`, `--avatar-tint-light`) and `:root[data-theme='light']
.avatar` picks the active one, so a theme switch repaints the face without a re-render. A row
with no seed (mock roster, older payload) falls back to the agent id, so no character is
faceless.

## Workspace Footprint

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
