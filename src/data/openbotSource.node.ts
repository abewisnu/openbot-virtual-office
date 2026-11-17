// Node-only module: loads the OpenBot SQLite database and returns agent profiles.
// This file is intentionally NOT imported statically from browser modules.
// It is lazy-loaded via dynamic import() from openbotSource.ts to keep the
// browser bundle clean (better-sqlite3 is a native Node addon, not usable in-browser).

import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  AGENT_PHASES,
  ACTIVITY_KINDS,
  type AgentPhase,
  type ActivityKind,
  type AgentActivity,
  type AgentProfile,
} from './openbotSource.ts';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ENV = z.object({
  OPENBOT_DB_PATH: z.string().optional(),
}).parse(process.env ?? {});

// Fallback to the documented default location. This is not a secret, just a
// path, so it is safe to keep as a constant.
export const DEFAULT_DB_PATH =
  ENV.OPENBOT_DB_PATH ??
  `${process.env.HOME ?? ''}/Library/Application Support/OpenBot/openbot.db`;

// ---------------------------------------------------------------------------
// Re-export types for consumers that import directly from the node module
// ---------------------------------------------------------------------------

export type { AgentPhase, ActivityKind, AgentActivity, AgentProfile };
export { AGENT_PHASES, ACTIVITY_KINDS };

// ---------------------------------------------------------------------------
// Row shapes coming straight out of SQLite (loose, then validated)
// ---------------------------------------------------------------------------

interface AgentRow {
  agent_id: string;
  sort_order: number;
  thread_id: string | null;
  agent_json: string;
}
interface UsageRow {
  occurred_at: string | null;
}
interface AtRow {
  at: string | null;
}
interface SessionRow {
  state: string | null;
  updated_at: string | null;
}
interface WaitRow {
  n: number;
}
interface RestartRow {
  n: number;
}
interface TurnRow {
  n: number;
}
interface ReadRow {
  thread_id: string;
  through_message_id: string;
}

// ---------------------------------------------------------------------------
// Zod schemas (validated at the DB boundary, per project rules)
// ---------------------------------------------------------------------------

const agentJsonSchema = z.object({
  name: z.string(),
  title: z.string().optional().default(''),
  provider: z.string().optional().default(''),
  model: z.string().optional().default(''),
  threadId: z.string().nullish(),
  avatarColor: z.string().nullish(),
  avatarHue: z.coerce.number().nullish(),
});

// ---------------------------------------------------------------------------
// Database handle
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  // mode: read-only, never create, never mutate.
  db = new Database(DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

/** Close the shared connection. Call on app teardown. */
export function closeOpenBotDb(): void {
  db?.close();
  db = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hueToHslShirt(hue: number): string {
  const h = Math.round(((hue % 360) + 360) % 360);
  return `hsl(${h}, 45%, 55%)`;
}

function derivePhase(input: {
  activeTurn: boolean;
  restart: number;
  wait: number;
  hasSession: boolean;
  sessionActive: boolean;
  sessionFresh: boolean;
  warmActive: boolean;
  recentlyActive: boolean;
}): AgentPhase {
  // Priority is fixed and shared by the endpoint, the store and the UI.
  if (input.wait > 0) return 'blocked';
  if (input.restart > 0) return 'restarting';
  if (input.activeTurn) return 'working';
  if (input.recentlyActive) return 'working';
  // 'ready' means "runtime is alive and ready right now", so it needs fresh
  // proof, not just a session row that still says active. A quiet session drops
  // to 'idle' once every piece of evidence is older than the grace window.
  if (input.sessionActive && (input.sessionFresh || input.warmActive)) return 'ready';
  if (input.hasSession) return 'idle';
  return 'stopped';
}

/** Status is derived from evidence inside this window, never from all-time counts. */
export const STATUS_WINDOW_MS = 90_000;

/** A restart marker only matters while it is fresh. */
export const RESTART_WINDOW_MS = 5 * 60_000;

/** 'ready' needs the session to have moved this recently (runtime alive). */
export const READY_WINDOW_MS = 10 * 60_000;

/**
 * Grace ceiling: an active session with no traffic for longer than this is
 * demoted from 'ready' to 'idle' — the proyeksi never closes a session that the
 * runtime left behind, so age is the only honest liveness signal.
 */
export const SESSION_STALE_MS = 30 * 60_000;

/** Activity weights: the single highest weight wins. */
const ACTIVITY_WEIGHT: Record<ActivityKind, number> = {
  waiting: 100,
  limited: 90,
  unread: 80,
  responded: 60,
  routine: 40,
  working: 20,
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Aggregate query: one pass, builds the full picture per agent
// ---------------------------------------------------------------------------

export function fetchAgentProfiles(): AgentProfile[] {
  const d = getDb();

  const agents = d
    .prepare(`SELECT agent_id, sort_order, thread_id, agent_json
         FROM projection_agents
         ORDER BY sort_order ASC`)
    .all() as AgentRow[];

  const usageStmt = d.prepare(
    `SELECT MAX(occurred_at) AS occurred_at FROM agent_usage_activity WHERE agent_id = ?`,
  );
  // Session state is aggregated across every thread the agent owns, not one thread.
  const sessionStmt = d.prepare(
    `SELECT s.state, s.updated_at FROM projection_provider_sessions s
       JOIN projection_threads t ON t.thread_id = s.thread_id
      WHERE t.agent_id = ?
      ORDER BY s.last_event_sequence DESC LIMIT 1`,
  );
  const waitStmt = d.prepare(
    `SELECT COUNT(1) AS n FROM agent_waits WHERE agent_id = ? AND woken_at IS NULL`,
  );
  const restartStmt = d.prepare(
    `SELECT MAX(a.created_at) AS at FROM projection_thread_activities a
       JOIN projection_threads t ON t.thread_id = a.thread_id
      WHERE t.agent_id = ? AND a.activity_type LIKE '%restart%'`,
  );
  const activeTurnStmt = d.prepare(
    `SELECT COUNT(1) AS n FROM projection_threads
      WHERE agent_id = ? AND active_turn_id IS NOT NULL`,
  );
  const recentActivityStmt = d.prepare(
    `SELECT MAX(a.created_at) AS at FROM projection_thread_activities a
       JOIN projection_threads t ON t.thread_id = a.thread_id
      WHERE t.agent_id = ? AND a.activity_type IN ('turn.completed', 'delivery.completed')`,
  );
  const deliveryStmt = d.prepare(
    `SELECT MAX(created_at) AS at FROM projection_deliveries
      WHERE recipient_agent_id = ? AND status = 'completed'`,
  );
  const readStmt = d.prepare(
    `SELECT through_message_id FROM projection_thread_reads
       WHERE thread_id = ? AND member_id = ?`,
  );
  const cursorOrdinalStmt = d.prepare(
    `SELECT ordinal FROM projection_thread_messages
      WHERE thread_id = ? AND message_id = ?`,
  );
  const threadMsgStmt = d.prepare(
    `SELECT ordinal FROM projection_thread_messages WHERE thread_id = ?`,
  );

  const now = Date.now();

  const profiles: AgentProfile[] = agents.map((a) => {
    const json = agentJsonSchema.parse(JSON.parse(a.agent_json));
    const usage = usageStmt.get(a.agent_id) as UsageRow | undefined;
    const session = sessionStmt.get(a.agent_id) as SessionRow | undefined;
    const wait = (waitStmt.get(a.agent_id) as WaitRow | undefined)?.n ?? 0;
    const restartAt = parseTime((restartStmt.get(a.agent_id) as AtRow | undefined)?.at);
    const restart = restartAt !== null && now - restartAt < RESTART_WINDOW_MS ? 1 : 0;
    const activeTurn = ((activeTurnStmt.get(a.agent_id) as TurnRow | undefined)?.n ?? 0) > 0;

    const usageMs = parseTime(usage?.occurred_at);
    const recentTurnMs = parseTime((recentActivityStmt.get(a.agent_id) as AtRow | undefined)?.at);
    const recentDeliveryMs = parseTime((deliveryStmt.get(a.agent_id) as AtRow | undefined)?.at);
    const recentlyActive =
      (usageMs !== null && now - usageMs < STATUS_WINDOW_MS) ||
      (recentTurnMs !== null && now - recentTurnMs < STATUS_WINDOW_MS) ||
      (recentDeliveryMs !== null && now - recentDeliveryMs < STATUS_WINDOW_MS);
    const recentlyResponded = usageMs !== null && now - usageMs < STATUS_WINDOW_MS;

    // Freshness for 'ready': a moving session proves the runtime is alive now;
    // recent traffic earns a grace period before the badge falls back to idle.
    const sessionUpdatedMs = parseTime(session?.updated_at);
    const sessionFresh =
      session?.state === 'active' &&
      sessionUpdatedMs !== null &&
      now - sessionUpdatedMs <= READY_WINDOW_MS;
    const warmActive =
      (usageMs !== null && now - usageMs <= SESSION_STALE_MS) ||
      (recentTurnMs !== null && now - recentTurnMs <= SESSION_STALE_MS) ||
      (recentDeliveryMs !== null && now - recentDeliveryMs <= SESSION_STALE_MS);

    // Unread compares numeric ordinals, never TEXT message ids.
    let unreadCount = 0;
    if (a.thread_id) {
      const cursor = readStmt.get(a.thread_id, a.agent_id) as ReadRow | undefined;
      if (cursor?.through_message_id) {
        const cursorOrdinal = (
          cursorOrdinalStmt.get(a.thread_id, cursor.through_message_id) as
            | { ordinal?: number }
            | undefined
        )?.ordinal;
        if (cursorOrdinal !== undefined) {
          const rows = threadMsgStmt.all(a.thread_id) as Array<{ ordinal: number }>;
          unreadCount = rows.filter((m) => m.ordinal > cursorOrdinal).length;
        }
      }
    }

    const candidates: AgentActivity[] = [];
    if (wait > 0)
      candidates.push({ kind: 'waiting', variant: 'question', priority: ACTIVITY_WEIGHT.waiting });
    if (unreadCount > 0)
      candidates.push({
        kind: 'unread',
        variant: String(unreadCount),
        priority: ACTIVITY_WEIGHT.unread,
      });
    if (recentlyResponded)
      candidates.push({
        kind: 'responded',
        variant: 'assistant',
        priority: ACTIVITY_WEIGHT.responded,
      });
    if (activeTurn)
      candidates.push({
        kind: 'working',
        variant: 'turn',
        priority: ACTIVITY_WEIGHT.working,
      });

    // Highest weight wins; ties fall back to kind for stable output.
    candidates.sort((x, y) => y.priority - x.priority || x.kind.localeCompare(y.kind));
    const activity = candidates.length ? candidates[0] : null;

    const phase = derivePhase({
      activeTurn,
      restart,
      wait,
      hasSession: Boolean(session),
      sessionActive: session?.state === 'active',
      sessionFresh,
      warmActive,
      recentlyActive,
    });
    return {
      agentId: a.agent_id,
      name: json.name,
      role: json.title,
      provider: json.provider,
      model: json.model,
      avatarColor: json.avatarColor ?? null,
      avatarHue: json.avatarHue ?? 0,
      phase,
      activity,
      unreadCount,
      threadId: a.thread_id,
    };
  });

  return profiles;
}
