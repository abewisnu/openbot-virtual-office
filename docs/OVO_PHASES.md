# OVO — Phases & Activity

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

## Activity Kinds

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

## Phases

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

## What Each Phase Does per Activity

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
