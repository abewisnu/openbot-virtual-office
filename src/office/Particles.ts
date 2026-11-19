/**
 * Runtime pixel-aligned particle layer for the 32-bit look. Three emitters
 * carry the whole effect:
 *
 * - dust motes drifting through the window light (pixel-grid snapped)
 * - stepped pixel steam puffs curling off the pantry dispenser and lounge coffee table
 * - cool air pixel wisps spilling from the NOC CRAC louvres
 *
 * Everything is snapped to the 2 px art grid and drawn into one `Graphics` per
 * frame so motes never look like smooth anti-aliased vector circles.
 */
import { Container, Graphics } from 'pixi.js';
import { ART, WORLD_H, WORLD_W } from '../constants';
import type { DayKey } from './DayCycle';

export type EmitKind = 'steam' | 'air';

export interface EmitSpot {
  x: number;
  y: number;
  kind: EmitKind;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  kind: EmitKind | 'dust';
}

/** Window shafts in world px, matching the baked wall art: motes gather here. */
const SHAFTS = [16, 336, 656].map((x) => ({ x0: x * 2, x1: (x + 288) * 2, y0: 170, y1: 780 }));

const DUST_COUNT = 56;
const MAX_MOTES = 150;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const snap = (v: number) => Math.round(v / ART) * ART;

const DUST_COLOR: Record<DayKey, number> = {
  day: 0xfff2c8,
  dawn: 0xffd5a8,
  dusk: 0xffb380,
  night: 0xaec6ff,
};

export class Particles {
  private layer = new Container();
  private g = new Graphics();
  private motes: Mote[] = [];
  /** 0 hides the layer, 1 is the full budget. Set from measured frame time. */
  private quality = 1;
  private dayKey: DayKey = 'day';

  constructor() {
    this.layer.eventMode = 'none';
    this.layer.addChild(this.g);
    const shaft = SHAFTS[Math.floor(Math.random() * SHAFTS.length)];
    for (let i = 0; i < DUST_COUNT; i++) {
      this.motes.push({
        x: rnd(shaft.x0, shaft.x1),
        y: rnd(shaft.y0, shaft.y1),
        vx: rnd(-5, 5),
        vy: rnd(-7, -2),
        age: Math.random() * 9,
        life: rnd(7, 14),
        size: Math.random() < 0.35 ? 3 : 2,
        kind: 'dust',
      });
    }
  }

  /** Mounts above the sorted props: steam and haze rise over the furniture. */
  mount(root: Container, above: Container, before: Container) {
    const at = root.getChildIndex(before);
    root.addChildAt(this.layer, at >= 0 ? at : root.children.length);
    void above;
  }

  /**
   * Budget scale for the whole layer: 1 is the shipped density, 0 hides it.
   * World drives this from measured frame time, and pins it to 0 under
   * `prefers-reduced-motion` because drifting motes are pure decoration.
   */
  setQuality(v: number) {
    const q = Math.max(0, Math.min(1, v));
    if (q === this.quality) return;
    this.quality = q;
    this.layer.visible = q > 0;
    if (q === 0) this.g.clear();
  }

  setDayKey(key: DayKey) {
    this.dayKey = key;
  }

  private spawn(spot: EmitSpot) {
    if (this.motes.length >= this.budget()) return;
    const steam = spot.kind === 'steam';
    this.motes.push({
      x: spot.x + rnd(steam ? -2 : -5, steam ? 2 : 5),
      y: spot.y + rnd(-2, 2),
      vx: rnd(steam ? -3 : -7, steam ? 3 : 7),
      vy: steam ? rnd(-16, -10) : rnd(-6, -3),
      age: 0,
      life: steam ? rnd(1.6, 2.6) : rnd(2.4, 3.6),
      size: steam ? 2 : 3,
      kind: spot.kind,
    });
  }

  private budget() { return Math.round(MAX_MOTES * this.quality); }
  private dustTarget() { return Math.round(DUST_COUNT * this.quality); }

  update(dt: number, spots: EmitSpot[]) {
    if (this.quality <= 0) return;
    // Emitter cadence is spread over the frame so a slow frame does not dump a
    // whole second of steam into one spot.
    for (const spot of spots) {
      const perSecond = (spot.kind === 'steam' ? 5 : 3) * this.quality;
      if (Math.random() < perSecond * dt) this.spawn(spot);
    }
    const keep: Mote[] = [];
    for (const m of this.motes) {
      m.age += dt;
      if (m.age >= m.life) continue;
      // Steam slows as it rises; air haze drifts evenly; dust sways.
      const rise = m.kind === 'steam' ? 0.55 : 1;
      m.x += m.vx * dt + (m.kind === 'dust' ? Math.sin((m.age + m.y) * 0.9) * 3 * dt : 0);
      m.y += m.vy * dt * rise;
      if (m.kind === 'dust' && (m.y < 140 || m.x < 0 || m.x > WORLD_W || m.y > WORLD_H)) continue;
      keep.push(m);
    }
    // A shrunken budget trims from the front; fresh dust refills below.
    const budget = this.budget();
    if (keep.length > budget) keep.splice(0, keep.length - budget);
    // Replace burnt dust so the shafts never empty out.
    const dustTarget = this.dustTarget();
    let dust = keep.reduce((n, m) => n + (m.kind === 'dust' ? 1 : 0), 0);
    while (dust < dustTarget && keep.length < budget) {
      const shaft = SHAFTS[Math.floor(Math.random() * SHAFTS.length)];
      keep.push({
        x: rnd(shaft.x0, shaft.x1),
        y: shaft.y1,
        vx: rnd(-5, 5),
        vy: rnd(-7, -2),
        age: 0,
        life: rnd(7, 14),
        size: Math.random() < 0.35 ? 3 : 2,
        kind: 'dust',
      });
      dust++;
    }
    this.motes = keep;
    this.draw();
  }

  private draw() {
    this.g.clear();
    const dustCol = DUST_COLOR[this.dayKey];
    for (const m of this.motes) {
      const t = m.age / m.life;
      const fade = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
      const sx = snap(m.x);
      const sy = snap(m.y);
      if (m.kind === 'dust') {
        const s = m.size;
        this.g.rect(sx, sy, s, s).fill({ color: dustCol, alpha: 0.22 * fade });
      } else if (m.kind === 'steam') {
        const s = t > 0.45 ? 4 : 2;
        this.g.rect(sx, sy, s, s).fill({ color: 0xe8f4ff, alpha: 0.24 * fade });
        if (t > 0.25) {
          this.g.rect(sx + ART, sy - ART, 2, 2).fill({ color: 0xffffff, alpha: 0.12 * fade });
        }
      } else {
        this.g.rect(sx, sy, 4, 2).fill({ color: 0xa8dcf6, alpha: 0.18 * fade });
      }
    }
  }

  destroy() {
    this.layer.destroy({ children: true });
  }
}
