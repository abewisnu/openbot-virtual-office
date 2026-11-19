/**
 * Clock-driven daylight curve for the 32-bit look. The office does not switch
 * between two fixed tints: the colour wash, its strength and the window-ray
 * strength all interpolate between keyframes across a 24 h clock, so an
 * afternoon slowly warms into sunset and a late night cools into moonlight.
 *
 * The curve lives apart from `Atmosphere` so it can be evaluated in a test,
 * without a canvas: `daylightAt()` is a pure function of the hour.
 */
export type DayKey = 'night' | 'dawn' | 'day' | 'dusk';
export type DaylightMode = 'auto' | DayKey;

export const DAYLIGHT_MODES: readonly DaylightMode[] = ['auto', 'dawn', 'day', 'dusk', 'night'];

export const DAYLIGHT_LABEL: Record<DaylightMode, string> = {
  auto: 'Auto (Clock)',
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

const MODE_HOUR: Record<DayKey, number> = {
  dawn: 6,
  day: 12,
  dusk: 17.5,
  night: 22.5,
};

export interface Daylight {
  key: DayKey;
  /** True while the baked background should use its night pass. */
  night: boolean;
  /** Wash colour painted over the whole viewport. */
  tint: number;
  /** Wash opacity, kept low so the art underneath keeps its contrast. */
  tintAlpha: number;
  /** Multiplier on the window god rays; 1 is a bright afternoon. */
  rayScale: number;
  /** Dark ambient veil strength for low-key / pool-of-light night atmosphere (0 = bright day). */
  ambientDark: number;
}

interface Keyframe {
  hour: number;
  key: DayKey;
  tint: number;
  alpha: number;
  rays: number;
  dark: number;
}

/**
 * Keyframes in clock order. 19.5 → 24 → 4.5 reads as full night (low-key dark
 * ambient lighting with pools of light), 6 is warm dawn, 8–16 bright day,
 * 17.5 warm sunset dusk.
 */
const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, key: 'night', tint: 0x16224a, alpha: 0.13, rays: 0.34, dark: 0.56 },
  { hour: 4.5, key: 'night', tint: 0x16224a, alpha: 0.13, rays: 0.30, dark: 0.54 },
  { hour: 6, key: 'dawn', tint: 0xff9e6b, alpha: 0.08, rays: 0.58, dark: 0.14 },
  { hour: 8, key: 'day', tint: 0xffd9a0, alpha: 0.04, rays: 1, dark: 0 },
  { hour: 16, key: 'day', tint: 0xffd9a0, alpha: 0.04, rays: 1, dark: 0 },
  { hour: 17.5, key: 'dusk', tint: 0xff7a4d, alpha: 0.10, rays: 0.72, dark: 0.28 },
  { hour: 19.5, key: 'night', tint: 0x16224a, alpha: 0.13, rays: 0.34, dark: 0.56 },
];

/** Wrap an hour into [0, 24). */
export function wrapHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return ((h % 24) + 24) % 24;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Channel-wise colour blend, so the wash sweeps hue instead of snapping. */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t)), g = Math.round(lerp(ag, bg, t)), bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/**
 * Daylight state for a clock reading. Every field eases between the frames
 * that bracket the hour, so consecutive frames differ by a tiny amount and the
 * light never pops. The `key` (and therefore the baked background pass) only
 * changes on a frame boundary.
 */
export function daylightAt(hours: number): Daylight {
  const h = wrapHour(hours);
  let from = KEYFRAMES[KEYFRAMES.length - 1];
  let to = KEYFRAMES[0];
  let span = to.hour + 24 - from.hour;
  for (let i = 0; i < KEYFRAMES.length; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[(i + 1) % KEYFRAMES.length];
    const width = b.hour > a.hour ? b.hour - a.hour : b.hour + 24 - a.hour;
    const inside = b.hour > a.hour ? h >= a.hour && h < b.hour : h >= a.hour || h < b.hour;
    if (inside) {
      from = a;
      to = b;
      span = width;
      break;
    }
  }
  const travelled = to.hour > from.hour ? h - from.hour : h >= from.hour ? h - from.hour : h + 24 - from.hour;
  const t = span > 0 ? Math.min(1, Math.max(0, travelled / span)) : 0;
  const key = t < 0.5 ? from.key : to.key;
  return {
    key,
    night: key === 'night',
    tint: mixColor(from.tint, to.tint, t),
    tintAlpha: lerp(from.alpha, to.alpha, t),
    rayScale: lerp(from.rays, to.rays, t),
    ambientDark: lerp(from.dark, to.dark, t),
  };
}

/** Resolve daylight from either the system clock (`auto`) or an explicit phase override. */
export function daylightForMode(mode: DaylightMode, now = new Date()): Daylight {
  if (mode === 'auto') {
    return daylightAt(now.getHours() + now.getMinutes() / 60);
  }
  return daylightAt(MODE_HOUR[mode]);
}
