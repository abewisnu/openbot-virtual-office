/**
 * Deterministic pixel identity for an agent, derived from the avatar fields
 * OpenBot keeps in the database: `projection_agents.agent_json` carries
 * `avatarSeed` (always set), `avatarHue` and `avatarColor` (sometimes null).
 * OpenBot stores no avatar image, so the face is computed, never fetched.
 *
 * The recipe mirrors OpenBot's own, which was read from its renderer bundle:
 *
 *   stableIndex(value, length) = FNV-1a of `value`, taken modulo `length`
 *   shape      <- `${seed}:${agentId}:shape`
 *   expression <- `${seed}:${agentId}:expression`
 *   color      <- avatarColor, else the hue palette
 *
 * `agentId` is part of the hash on purpose: several agents share a seed such as
 * `first-bot:face:123` (Iwa, Neke, Clubo on this machine), and without it they
 * would get one identical face, separated only by tint.
 *
 * OpenBot's own sprite lists are not readable from the bundle, so the feature
 * lists below are OVO's. Same seed, same face, every render, in every client —
 * but the exact silhouette will not match the OpenBot window pixel for pixel.
 *
 * Two tint variants are returned, one per UI theme. Each is clamped in HSL
 * lightness until it reaches 3:1 against that theme's info-panel surface *and*
 * keeps the ink at 3:1, so a face never melts into the panel.
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
export type ThemeName = 'dark' | 'light';

/** Ink used for every face feature. Fixed: the office art is not themed. */
export const AVATAR_INK = '#14121c';

/**
 * The two surfaces an avatar tile sits on, per theme. They are NOT the same
 * colour, so the names matter:
 *
 * - `tile`   the 56x56 box behind the face, `.avatar` background two layers of
 *            `--ovo-surface` over the panel.
 * - `gutter` the info-panel body around that box, `.panel.info` background over
 *            the page backdrop. The face never covers it, but it is the harder
 *            surface to clear in the light theme (`#edebe9` is darker than the
 *            tile), so it is the one the clamp is tuned against.
 *
 * Both are already composited over whatever sits behind them:
 *
 *   dark   tile   rgba(29, 23, 34, 0.88) over #14121c -> #1c1621
 *          gutter #1b1621
 *   light  tile   rgba(252, 251, 248, 0.92) over #f4f1ea -> #fbfaf7
 *          gutter #edebe9
 *
 * `scripts/verify-avatar.mjs` imports these constants and prints a ratio
 * column for each, so a report can say which surface was measured.
 */
export const AVATAR_SURFACES: Record<ThemeName, { tile: string; gutter: string }> = {
  dark: { tile: '#1c1621', gutter: '#1b1621' },
  light: { tile: '#fbfaf7', gutter: '#edebe9' },
};

/** Minimum contrast ratio a face must keep against either surface. */
export const MIN_CONTRAST = 3;

/**
 * The light clamp aims slightly above the 3:1 floor, so hex rounding and the
 * bisection tolerance cannot drop a tile back under it against the gutter.
 */
export const LIGHT_GUTTER_TARGET = 3.08;

export interface AvatarSpec {
  /** Per-theme head tint, already resolved to a CSS hex color. */
  tints: Record<ThemeName, string>;
  shape: HeadShape;
  expression: Expression;
  hair: HairStyle;
  accessory: Accessory;
}

/** Longest seed the boundary accepts; matches OpenBot's own limit. */
export const AVATAR_SEED_MAX = 128;

// ---------------------------------------------------------------------------
// Color math (pure, no dependencies)
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue(p, q, h + 1 / 3) * 255,
    g: hue(p, q, h) * 255,
    b: hue(p, q, h - 1 / 3) * 255,
  };
}

/** Luminance is monotonic in HSL lightness, so a bisection is enough. */
function withLuminance(rgb: Rgb, target: number): Rgb {
  const hsl = rgbToHsl(rgb);
  let lo = hsl.l;
  let hi = 1;
  if (relativeLuminance(rgb) > target) {
    lo = 0;
    hi = hsl.l;
  }
  let best = rgb;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = hslToRgb({ ...hsl, l: mid });
    const lum = relativeLuminance(candidate);
    best = candidate;
    if (lum < target) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Tint luminance that exactly reaches `ratio` against a lighter surface. */
function luminanceUnder(surface: Rgb, ratio: number): number {
  return (relativeLuminance(surface) + 0.05) / ratio - 0.05;
}

/**
 * Luminance band a tint is clamped into, per theme.
 *
 * The max is derived from the surfaces rather than hand-tuned, so the band
 * cannot drift away from what the UI paints: in the light theme the gutter
 * (`#edebe9`) is darker than the avatar tile (`#fbfaf7`), so it is the binding
 * surface. The min keeps the ink (`#14121c`) legible inside the tile.
 */
function tintBand(theme: ThemeName): { min: number; max: number } {
  if (theme === 'dark') {
    // The dark surfaces are near-black: lift the tint until it clears the floor.
    return { min: 0.15, max: 1 };
  }
  return {
    min: 0.145,
    max: luminanceUnder(hexToRgb(AVATAR_SURFACES.light.gutter), LIGHT_GUTTER_TARGET),
  };
}

/** Clamp a tint into the theme's luminance band, keeping hue and saturation. */
export function tintForTheme(base: Rgb, theme: ThemeName): string {
  const band = tintBand(theme);
  const lum = relativeLuminance(base);
  if (lum >= band.min && lum <= band.max) return rgbToHex(base);
  const target = lum < band.min ? band.min : band.max;
  return rgbToHex(withLuminance(base, target));
}

// ---------------------------------------------------------------------------
// Seed + spec
// ---------------------------------------------------------------------------

/**
 * FNV-1a over the string, then a murmur3-style avalanche, then modulo `length`.
 *
 * The avalanche is required: raw FNV-1a has weak low bits, so two seeds that
 * differ only near the end (two agent ids sharing `first-bot:face:123`) landed
 * on the same shape, expression, hair and accessory. Mixing the high bits down
 * keeps the function deterministic while separating those ids.
 */
export function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % length;
}

/** Base tint before the theme clamp: explicit color, then the hue palette. */
export function avatarTint(input: { hue: number; color: string | null }): string {
  if (input.color) return input.color;
  const hue = Math.round(((input.hue % 360) + 360) % 360);
  return HUE_TINTS[hue] ?? rgbToHex(hslToRgb({ h: hue / 360, s: 0.45, l: 0.55 }));
}

/** Both theme variants of the base tint. */
export function avatarTints(input: { hue: number; color: string | null }): Record<ThemeName, string> {
  const base = hexToRgb(avatarTint(input));
  return { dark: tintForTheme(base, 'dark'), light: tintForTheme(base, 'light') };
}

/**
 * Build the face for an agent. A missing seed (mock roster, degraded payload)
 * falls back to the agent id, so every row still gets a stable, distinct face.
 */
export function avatarSpec(input: {
  seed: string | null;
  hue: number;
  color: string | null;
  agentId?: string;
  fallbackSeed?: string;
}): AvatarSpec {
  const seed = sanitizeSeed(input.seed ?? input.fallbackSeed ?? 'openbot-agent');
  const identity = sanitizeSeed(input.agentId ?? input.fallbackSeed ?? 'openbot-agent');
  const key = `${seed}:${identity}`;
  return {
    tints: avatarTints(input),
    shape: HEAD_SHAPES[stableIndex(`${key}:shape`, HEAD_SHAPES.length)],
    expression: EXPRESSIONS[stableIndex(`${key}:expression`, EXPRESSIONS.length)],
    hair: HAIR_STYLES[stableIndex(`${key}:hair`, HAIR_STYLES.length)],
    accessory: ACCESSORIES[stableIndex(`${key}:accessory`, ACCESSORIES.length)],
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
