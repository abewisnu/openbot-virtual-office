/**
 * Runtime atmosphere pass for the 32-bit look: window god rays and floor light
 * pools live in world space (they belong to the room), while the vignette and
 * the ambient colour wash live in screen space (they belong to the camera).
 * Everything is additive or low-alpha, so it deepens the scene without changing
 * any sprite size, collision box or hit target.
 */
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ART, WORLD_H, WORLD_W } from '../constants';
import type { Daylight } from './DayCycle';

/** Windows in the wall band, in art px: x and width, matching the background art. */
const WINDOWS = [16, 336, 656];
const WINDOW_W = 288;
/** Wall band ends here in art px; rays start at the window sill. */
const SILL_ART = 80;

export interface AtmosphereState {
  daylight: Daylight;
  /** Number of `working` agents: the brighter the office, the stronger the rays. */
  working: number;
}

function vignetteTexture(): Texture {
  // Deliberately low resolution: nearest-neighbour upscaling turns the gradient
  // into chunky stepped bands, which is what the pixel-art palette wants.
  const w = 96, h = 60;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, h * 0.86);
  g.addColorStop(0, 'rgba(8,6,14,0)');
  g.addColorStop(0.62, 'rgba(8,6,14,0.10)');
  g.addColorStop(1, 'rgba(8,6,14,0.62)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  return Texture.from(cv);
}

export class Atmosphere {
  private world = new Container();
  private screen = new Container();
  private rays = new Graphics();
  private pools = new Graphics();
  private wash = new Graphics();
  private vignette = new Sprite(vignetteTexture());
  private t = 0;
  private w = 0;
  private h = 0;
  /** `prefers-reduced-motion`: freeze the breathe and drop the light strength. */
  private calm = false;
  /** Last wash colour/alpha, so a still frame never rebuilds the same rect. */
  private washKey = '';

  setCalm(v: boolean) { this.calm = v; }

  mountWorld(root: Container, before: Container) {
    this.world.eventMode = 'none';
    this.world.addChild(this.pools, this.rays);
    const at = root.getChildIndex(before);
    root.addChildAt(this.world, at >= 0 ? at : root.children.length);
    this.drawRays();
  }

  mountScreen(stage: Container) {
    this.screen.eventMode = 'none';
    this.vignette.anchor.set(0.5);
    this.screen.addChild(this.wash, this.vignette);
    stage.addChild(this.screen);
  }

  resize(width: number, height: number) {
    this.w = width; this.h = height;
    // The wash rect is screen-sized, so a resize must invalidate the cached key.
    this.washKey = '';
    this.vignette.width = width; this.vignette.height = height;
    this.vignette.position.set(width / 2, height / 2);
  }

  update(dt: number, state: AtmosphereState) {
    // Reduced motion freezes the breathe at whatever value it holds, so the
    // room keeps its light level but stops pulsing.
    if (!this.calm) this.t += dt;
    // Slow breathing so the room reads alive, plus a workload term so a busy
    // office is visibly brighter than a standby one.
    const busy = Math.min(1, state.working / 6);
    const breathe = 0.72 + 0.28 * Math.sin(this.t * 0.55);
    const day = state.daylight;
    const strength = day.rayScale * (0.42 + 0.30 * breathe) + busy * 0.35;
    this.rays.alpha = Math.min(1, strength);
    this.pools.alpha = Math.min(1, strength * 1.1);
    // Colour wash follows the clock curve: warm daylight, amber dusk, cold
    // moonlight. Alpha stays low so nothing underneath loses contrast, and the
    // rect is only rebuilt when the colour actually moves (clock tick, phase).
    const key = `${day.tint}:${day.tintAlpha}`;
    if (key !== this.washKey) {
      this.washKey = key;
      this.wash.clear();
      this.wash.rect(0, 0, this.w, this.h).fill({ color: day.tint, alpha: day.tintAlpha });
    }
    // Vignette eases toward the phase instead of snapping on a phase change.
    this.vignette.alpha = day.night ? 1 : 0.82;
  }

  /** Static geometry; only `alpha` animates, so no per-frame path rebuild. */
  private drawRays() {
    this.rays.clear();
    this.pools.clear();
    const sill = SILL_ART * ART;
    for (const wx of WINDOWS) {
      const x0 = wx * ART, x1 = (wx + WINDOW_W) * ART;
      // Shaft: the window opening, splayed outward as the light falls.
      this.rays
        .poly([x0 + 18, sill, x1 - 18, sill, x1 + 96, WORLD_H * 0.62, x0 - 96, WORLD_H * 0.62])
        .fill({ color: 0xfff2c8, alpha: 0.10 });
      this.rays
        .poly([x0 + 96, sill, x1 - 96, sill, x1 - 24, WORLD_H * 0.42, x0 + 24, WORLD_H * 0.42])
        .fill({ color: 0xfff8e2, alpha: 0.07 });
      // Pool: the patch of floor the shaft actually lands on.
      this.pools
        .ellipse((x0 + x1) / 2, sill + 210, (x1 - x0) * 0.62, 108)
        .fill({ color: 0xffe9b8, alpha: 0.055 });
      this.pools
        .ellipse((x0 + x1) / 2, sill + 210, (x1 - x0) * 0.4, 66)
        .fill({ color: 0xfff6d8, alpha: 0.05 });
    }
  }
}
