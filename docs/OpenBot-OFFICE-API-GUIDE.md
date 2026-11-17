# OpenBot Virtual Office (OVO) — Implementation Guide

`OpenBot Virtual Office`, shortened to **OVO**, visualises OpenBot's ongoing work as a 2D pixel-art
office. It is an **observer**: no chat, no instruction box, no way to command an agent. Tasks are
given in OpenBot; OVO only renders the result.

How the shipped code turns the OpenBot database into the pixel office, file by file, so a
change can be made without guessing. Contract details: `OPENBOT_OFFICE_API.md`. Process and
operations: `OPENBOT_OFFICE_RUNTIME.md`.

**Status of record (2026-11-17):** one endpoint (`GET /api/agents`), served by the Vite
dev-only plugin. No production server, no `/health`, no ETag, no folder grouping.

---

## 1. Architecture as built

```text
openbot.db (SQLite, WAL, read-only)
        │ better-sqlite3, singleton handle, 11 prepared statements
        ▼
src/data/openbotSource.node.ts      fetchAgentProfiles() → AgentProfile[]
        │ imported by the Vite plugin only (never by the browser)
        ▼
vite-plugin-openbot.ts              GET /api/agents, guards, header/field stripping
        │ HTTP, same origin as the app
        ▼
src/data/openbotSource.ts           fetch + Zod safeParse → AgentProfile[]
        │
        ▼
src/store/useStore.ts               employees[], setInterval polling, mock fallback
        │
        ├──▶ src/office/World.ts    positions, desk assignment, typing, dot colour
        └──▶ src/components/*.tsx   sidebar counts, detail panel
```

No websocket, no SSE, no write path to the database.

| Layer | Runtime | Owns |
|---|---|---|
| `openbotSource.node.ts` | Node (server) | SQLite access, phase + activity derivation |
| `vite-plugin-openbot.ts` | Node (dev server) | HTTP guards, response headers, field stripping |
| `openbotSource.ts` | browser | fetch, Zod boundary, public types |
| `useStore.ts` | browser | polling loop, state, mock fallback |
| `World.ts` / components | browser | simulation and rendering |

The browser never holds a DB path, a credential, or SQL. It knows one URL and one schema.

---

## 2. File map

| File | Responsibility | Change it when |
|---|---|---|
| `src/data/openbotSource.ts` | public types, `AGENT_PHASES`, `ACTIVITY_KINDS`, Zod `agentProfileSchema`, `fetchAgentProfilesAsync` | the wire contract changes |
| `src/data/openbotSource.node.ts` | env parse, DB handle, SQL, `derivePhase`, `ACTIVITY_WEIGHT`, window constants | derivation or query changes |
| `vite-plugin-openbot.ts` | `/api/agents`, Host/method guards, headers, field strip | transport or security changes |
| `src/store/useStore.ts` | `toEmployee`, `statusForPhase`, `startPolling` / `stopPolling`, mock fallback | state or polling changes |
| `src/data/mockEmployees.ts` | fallback roster | the demo scene changes |
| `src/constants.ts` | `PHASE_COLORS`, `PHASE_LABEL`, `ACTIVITY_LABEL`, `badgeFor`, `shirtColorFor` | colours or labels change |
| `src/office/World.ts` | `assign`, `owesDesk`, desk seats, typing, `setDot` | behaviour or movement changes |
| `src/office/Layout.ts` | `buildLayout(deskCount)`, seats `WS-NN` | office geometry changes |
| `src/components/HUD.tsx` | sidebar phase counts and rows | sidebar changes |
| `src/components/CharacterInfo.tsx` | detail panel: dot, phase label, activity note | panel changes |
| `scripts/verify-openbot-source.mjs` | source gate: types, schema, phase rules, bundle hygiene | a rule becomes checkable |
| `vite.config.ts` | plugins, `better-sqlite3` externalisation | build config changes |

---

## 3. Contract

Defined **once** in `src/data/openbotSource.ts`; the Node module re-uses the same types, so
the endpoint, the CLI verifier and the UI cannot drift.

```ts
export const AGENT_PHASES = [
  'idle', 'starting', 'ready', 'working', 'restarting', 'blocked', 'stopped',
] as const;

export const ACTIVITY_KINDS = [
  'waiting', 'limited', 'routine', 'working', 'unread', 'responded',
] as const;

export interface AgentActivity {
  kind: ActivityKind;
  variant?: string;
  priority: number;
  resetsAt?: string;   // 'limited' only; never emitted today
}

// wire shape after server-side stripping
const agentProfileSchema = z.object({
  agentId: z.string().min(1),
  name: z.string(),
  role: z.string(),
  avatarColor: z.string().nullable(),
  avatarHue: z.number(),
  phase: z.enum(AGENT_PHASES),
  activity: activitySchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
});
```

`AgentProfile` (the internal shape) still carries `provider`, `model` and `threadId`. Those
are **server-only**: the plugin strips them and the client defaults them to `''` / `null`.
Do not add them to the response — they are machine details the browser has no use for.

`ACTIVITY_PRIORITY` used to be exported from `openbotSource.ts` with inverse numbers
(`waiting: 1 … responded: 6`). It was unused by every consumer and contradicted the real
weights, so it was removed. **The only authoritative weights are `ACTIVITY_WEIGHT` in
`openbotSource.node.ts`:**

| kind | weight |
|---|---|
| `waiting` | 100 |
| `limited` | 90 |
| `unread` | 80 |
| `responded` | 60 |
| `routine` | 40 |
| `working` | 20 |

---

## 4. Derivation

`derivePhase()` is a fixed top-down cascade; the first match wins:

```text
waits > 0                      → blocked
restart marker < 5 min         → restarting
active_turn_id present         → working
usage/turn/delivery < 90 s     → working
session active AND fresh       → ready
session exists                 → idle
otherwise                      → stopped
```

"Session active AND fresh" means `state = 'active'` **and** (`updated_at` ≤ 10 min **or**
traffic ≤ 30 min). Freshness is mandatory: without it, sessions the runtime abandoned keep
agents green for days.

Activity is computed independently and never feeds the phase. Candidates are collected,
sorted by weight descending with a `kind` tie-breaker, and the first one wins. Only four
kinds are produced today: `waiting`, `unread`, `responded`, `working`.

`unreadCount` is derived from ordinals, not from a stored counter: read cursor
(`projection_thread_reads.through_message_id`) → ordinal via `projection_thread_messages`,
then count messages with a higher ordinal.

---

## 5. Wiring the API

### 5.1 Server side

```ts
export function openBotApiPlugin(): Plugin {
  return {
    name: 'openbot-api',
    configureServer(server) {
      server.middlewares.use('/api/agents', handleRequest);
    },
    close() { closeOpenBotDb(); },
  };
}
```

The plugin is registered in `vite.config.ts` next to `react()`. Guard order matters: Host
allowlist (`421`) → method (`405`) → query → serialise. Errors return
`{ error: 'Agent data unavailable' }` with the DB path and SQL kept in the server log only.

No `server.proxy` is needed: the middleware runs on the same origin as the app. If a real
backend is added later on another port, then a proxy is needed — and `changeOrigin: false`,
so the `Host` header stays loopback and the allowlist keeps working.

### 5.2 Client fetch

```ts
const API_ENDPOINT = '/api/agents';

export async function fetchAgentProfilesAsync(): Promise<AgentProfile[]> {
  try {
    const res = await fetch(API_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const out: AgentProfile[] = [];
    for (const entry of data) {
      const parsed = agentProfileSchema.safeParse(entry);
      if (!parsed.success) continue;          // one bad row costs one agent
      out.push({ ...parsed.data, provider: '', model: '', threadId: null });
    }
    return out;
  } catch {
    return [];
  }
}
```

Empty array is the single "no data" signal; the store turns it into the mock fallback.

### 5.3 Polling and fallback

```ts
let timer: ReturnType<typeof setInterval> | null = null;

export function startPolling(ms = 3000): void {
  if (timer) return;                 // idempotent: one loop per document
  const run = async () => { /* load, then set employees + source */ };
  void run();
  timer = setInterval(run, ms);
}
```

`GameCanvas.tsx` calls `startPolling(Number(import.meta.env.VITE_OFFICE_POLL_MS ?? 3000))`
once on mount and `stopPolling()` on unmount. No page reload is needed for new data.

Fallback: empty list or a thrown error sets `source = { source: 'mock', reason }`. The UI
still renders, so **the source badge must be checked before believing the screen.**

### 5.4 Mapping to the scene

| Step | Code |
|---|---|
| profile → employee | `toEmployee` in `useStore.ts` (`statusForPhase`, `WS-${index+1}`) |
| employee → position | `World.assign` (`status === 'working' \|\| owesDesk` → own desk) |
| badge dot | `badgeFor(emp).color` → `badgeFor` reads `PHASE_COLORS[phase]` only |
| sidebar counts | `HUD.tsx` reduces `employees` by `phase` |

---

## 6. Test matrix

| Case | Expected | How to check |
|---|---|---|
| Dev server, DB present | `200`, JSON array, `Content-Type: application/json` | `curl -sI .../api/agents` |
| Payload shape | exactly 8 keys per agent, no `provider`/`model`/`threadId` | `curl -s ... \| python3 -m json.tool` |
| `POST /api/agents` | `405` + `Allow: GET, HEAD` | `curl -X POST -w '%{http_code}'` |
| `Host: evil.example` | `421` | `curl -H 'Host: evil.example'` |
| `GET /health` | `200 text/html` — SPA fallback, **not** a health check | `curl -sI /health` |
| `GET /api/office` | `200 text/html` — not implemented | `curl -sI /api/office` |
| Preview server | `/api/agents` → `200 text/html`, UI shows mock | `npm run preview`, then curl |
| DB missing | endpoint `500 { error: 'Agent data unavailable' }`, no path in body | set a bad `OPENBOT_DB_PATH` |
| One corrupt `agent_json` | that agent degrades, others intact | verify script + count |
| Agent with no session | `phase: stopped` | check the payload |
| Agent quiet > 30 min, session `active` | `phase: idle` | check the payload |
| Agent with unread | `activity.kind: unread`, dot still phase colour | check the payload + panel |
| Repeated poll | one request in flight; no page reload | network tab, `performance.timeOrigin` |
| Bundle hygiene | no `better-sqlite3`, no `turn.completed` in `dist/assets/` | `grep -rl` |
| Build | `tsc --noEmit` exit 0, `vite build` succeeds | `npm run build` |

---

## 7. Implementation order for the next change

1. Read `OPENBOT_OFFICE_API.md` §2-§4 and the matching code before editing.
2. Change the type/schema first (`openbotSource.ts`), then the derivation
   (`openbotSource.node.ts`), then the transport (`vite-plugin-openbot.ts`), then the UI.
3. Keep one expression of each rule. No second copy of a threshold in a component.
4. Run `npx tsc --noEmit`, `npm run build`, `node scripts/verify-openbot-source.mjs`.
5. Check the endpoint with `curl` — JSON, not HTML.
6. Update these docs in the same change; state what is measured and what is not.

---

## 8. Rules that must not be broken

- The database is opened `readonly: true, fileMustExist: true`. No migrations, no schema
  changes, no pragmas, no writes, ever.
- `agent_usage_activity` is the only source of truth for "is this agent working".
  `projection_agents.updated_at` is configuration metadata and would make everyone look
  permanently busy.
- The loopback bind plus the `Host` allowlist is the entire security boundary. No auth
  exists, so never widen the bind.
- One snapshot endpoint plus client polling. Add SSE or a file watch only if polling is
  measurably insufficient.
- The contract is defined once and validated with Zod at both edges.
- `activity` colours nothing. It is a text note; `phase` owns every indicator colour.
- No secret, DB path, or machine path in any `VITE_`-prefixed variable.
- OVO is an observer. Never add a chat, an instruction box, or a task-sending endpoint: the office
  renders OpenBot's work, it does not drive it.
- `dist/` is immutable per build; never patch built files.
- Stop processes by PID, never with `pkill -f`.
