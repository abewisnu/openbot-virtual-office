// Browser-safe interface layer for the OpenBot data source.
//
// In development the Vite plugin (vite-plugin-openbot.ts) exposes a
// /api/agents endpoint that reads the SQLite database server-side.
// In production, the same endpoint must be provided by the backend.
//
// All public types and constants are defined HERE so that importing this file
// is always safe in the browser.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain types (runtime phase + activity), aligned with the office spec
// ---------------------------------------------------------------------------

export const AGENT_PHASES = [
  'idle',
  'starting',
  'ready',
  'working',
  'restarting',
  'blocked',
  'stopped',
] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const ACTIVITY_KINDS = [
  'waiting',
  'limited',
  'routine',
  'working',
  'unread',
  'responded',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface AgentActivity {
  kind: ActivityKind;
  variant?: string;
  priority: number;
  /** Present for "limited" (usage reset) when a source provides it. */
  resetsAt?: string;
}

export interface AgentProfile {
  agentId: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  avatarColor: string | null;
  avatarHue: number;
  phase: AgentPhase;
  /** The single highest-priority activity, or null when there is none. */
  activity: AgentActivity | null;
  unreadCount: number;
  threadId: string | null;
}

// ---------------------------------------------------------------------------
// Pure helper (safe in browser)
// ---------------------------------------------------------------------------

/**
 * Deterministic shirt color for an agent profile.
 * Pure function — no DB access needed, safe in the browser.
 */
export function shirtColorFor(profile: { avatarColor: string | null; avatarHue: number }): string {
  if (profile.avatarColor) return profile.avatarColor;
  const h = Math.round(((profile.avatarHue % 360) + 360) % 360);
  return `hsl(${h}, 45%, 55%)`;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const API_ENDPOINT = '/api/agents';

// Validates the /api/agents payload at the boundary (channel rule: Zod at the
// edge). The endpoint returns the browser-safe subset only; provider/model/
// threadId are stripped server-side and defaulted here.
const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  variant: z.string().optional(),
  priority: z.number().default(0),
  resetsAt: z.string().optional(),
});

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

/**
 * Fetch agent profiles from the API endpoint.
 * Returns an empty array when the endpoint is unavailable or the payload is
 * malformed (caller falls back to mock).
 */
export async function fetchAgentProfilesAsync(): Promise<AgentProfile[]> {
  try {
    const res = await fetch(API_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const out: AgentProfile[] = [];
    for (const entry of data) {
      const parsed = agentProfileSchema.safeParse(entry);
      if (!parsed.success) continue;
      const a = parsed.data;
      out.push({
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        provider: '',
        model: '',
        threadId: null,
        avatarColor: a.avatarColor,
        avatarHue: a.avatarHue,
        phase: a.phase,
        activity: a.activity,
        unreadCount: a.unreadCount,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** No-op in browser; the API server manages its own connection lifecycle. */
export async function closeOpenBotDbAsync(): Promise<void> {
  /* nothing to close on the client side */
}
