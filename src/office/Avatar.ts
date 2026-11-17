/**
 * Deterministic pixel identity for an agent, derived from the avatar fields
 * OpenBot keeps in the database: `projection_agents.agent_json` carries
 * `avatarSeed` (always set), `avatarHue` and `avatarColor` (sometimes null).
 * OpenBot stores no avatar image, so the face is computed, never fetched.
 *
 * The recipe mirrors OpenBot's own, which was read from its renderer bundle:
 *
 *   stableIndex(value, length) = FNV-1a of `value`, taken modulo `length`
 *   shape      <- `${seed}:shape`
 *   expression <- `${seed}:expression`
 *   color      <- avatarColor, else the hue palette
 *
 * OpenBot's own sprite lists are not readable from the bundle, so the feature
 * lists below are OVO's. Same seed, same face, every render, in every client —
 * but the exact silhouette will not match the OpenBot window pixel for pixel.
 *
 * Pure module: no imports, no DOM, so `scripts/verify-avatar.mjs` can load it
 * with plain `node`.
 */

/** The hues released OpenBot clients know. Order matters; never reorder. */
export const AVATAR_HUES = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;

/**
 * OVO's approximation of the hue palette OpenBot ships. Only 100 and 245 are
 * the app's literal values; the rest are tuned to sit well on the pixel office.
 */
export const HUE_TINTS: Record<number, string> = {
  0: '#d1564f',
  30: '#d98b3f',
  55: '#d9b93f',
  100: '#8ece34',
  150: '#4fae6a',
  185: '#3fb3a8',
  215: '#3f7fc6',
  245: '#5d67ee',
  280: '#8a63d2',
  320: '#d464a2',
};

/** Head silhouettes, drawn as pixel blocks on a 12x12 grid. */
export const HEAD_SHAPES = ['square', 'round', 'tall', 'wide'] as const;
/** Mouth/eye sets. */
export const EXPRESSIONS = ['calm', 'smile', 'focused', 'surprised', 'tired'] as const;
/** Hair blocks above the head. */
export const HAIR_STYLES = ['none', 'flat', 'spike', 'side', 'cap'] as const;
/** Extra props drawn over the face. */
export const ACCESSORIES = ['none', 'glasses', 'headset'] as const;

export type HeadShape = (typeof HEAD_SHAPES)[number];
export type Expression = (typeof EXPRESSIONS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export interface AvatarSpec {
  /** Base tint for the head block, already resolved to a CSS color. */
  tint: string;
  shape: HeadShape;
  expression: Expression;
  hair: HairStyle;
  accessory: Accessory;
}

/** Longest seed the boundary accepts; matches OpenBot's own limit. */
export const AVATAR_SEED_MAX = 128;

/** FNV-1a over the string, modulo `length` — the same hash OpenBot uses. */
export function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

/**
 * Resolve the head tint: an explicit color wins, otherwise the nearest known
 * hue, otherwise the hue itself (agents whose hue is outside the palette).
 */
export function avatarTint(input: { hue: number; color: string | null }): string {
  if (input.color) return input.color;
  const hue = Math.round(((input.hue % 360) + 360) % 360);
  return HUE_TINTS[hue] ?? `hsl(${hue}, 45%, 55%)`;
}

/**
 * Build the face for an agent. A missing seed (mock roster, degraded payload)
 * falls back to the agent id, so every row still gets a stable, distinct face.
 */
export function avatarSpec(input: {
  seed: string | null;
  hue: number;
  color: string | null;
  fallbackSeed?: string;
}): AvatarSpec {
  const seed = sanitizeSeed(input.seed ?? input.fallbackSeed ?? 'openbot-agent');
  return {
    tint: avatarTint(input),
    shape: HEAD_SHAPES[stableIndex(`${seed}:shape`, HEAD_SHAPES.length)],
    expression: EXPRESSIONS[stableIndex(`${seed}:expression`, EXPRESSIONS.length)],
    hair: HAIR_STYLES[stableIndex(`${seed}:hair`, HAIR_STYLES.length)],
    accessory: ACCESSORIES[stableIndex(`${seed}:accessory`, ACCESSORIES.length)],
  };
}

/**
 * Keep a seed inside OpenBot's own shape (`/^[a-z0-9:-]{1,128}$/`). Anything
 * else — casing, spaces, control characters — is folded to a stable slug, so a
 * bad row cannot break the hash or leak raw text into the DOM.
 */
export function sanitizeSeed(seed: string): string {
  const folded = seed.trim().toLowerCase().replace(/[^a-z0-9:-]+/g, '-');
  const trimmed = folded.replace(/^-+|-+$/g, '');
  return (trimmed.length > 0 ? trimmed : 'openbot-agent').slice(0, AVATAR_SEED_MAX);
}
