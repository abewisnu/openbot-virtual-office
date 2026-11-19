/**
 * Runtime atmosphere pass for the 32-bit pixel-art look:
 * - Window god rays and floor light pools are baked onto a low-res pixel grid
 *   with 4x4 ordered Bayer dithering and stepped light bands (`nearest` scaled),
 *   so light shafts belong to the same pixel grid as the furniture.
 * - Local emissive pixel pools (active monitors, NOC racks, CRAC/UPS, pantry
 *   appliances) cast dithered screen/LED bounce onto the desks and floor,
 *   intensifying naturally at dusk and night.
 * - Ambient colour wash lives in screen space without darkening edges.
 */
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ART, WORLD_H, WORLD_W } from '../constants';
import type { Daylight } from './DayCycle';

/** Windows in the wall band, in art px: x and width, matching the background art. */
const WINDOWS = [16, 336, 656];
const WINDOW_W = 288;
/** Wall band ends here in art px; rays start at the window sill. */
const SILL_ART = 80;
/** Atmosphere pixel grid scale matching ART=2 (960x640 texels -> 2 screen px per texel). */
const ATMO_STEP = 2;
const ATMO_W = WORLD_W / ATMO_STEP;
const ATMO_H = WORLD_H / ATMO_STEP;

/** 4x4 Bayer threshold matrix normalized to [0..15] / 16. */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function bayerAt(x: number, y: number): number {
  return (BAYER_4X4[y & 3][x & 3] + 0.5) / 16;
}

export interface EmissiveLight {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  intensity: number;
  pulse?: number;
  /** How strongly this source carves through the low-key dark ambient veil (0..1). */
  cutout?: number;
}

export interface AtmosphereState {
  daylight: Daylight;
  /** Number of `working` agents: the brighter the office, the stronger the rays. */
  working: number;
  /** Enable low-key dark ambient veil & pool-of-light cutouts at night/dusk. */
  moodyLighting?: boolean;
  /** Live world-space emissive pools (active monitors, NOC hardware, appliances). */
  lights?: EmissiveLight[];
}

/**
 * Pixel-art window god rays + floor pools baked once onto a 480x320 texture
 * using stepped luminance bands and 4x4 Bayer dithering.
 */
function buildPixelLightTextures(): { rays: Texture; pools: Texture } {
  const mkCanvas = () => {
    const cv = document.createElement('canvas');
    cv.width = ATMO_W;
    cv.height = ATMO_H;
    return cv;
  };
  const raysCv = mkCanvas();
  const poolsCv = mkCanvas();
  const rCtx = raysCv.getContext('2d')!;
  const pCtx = poolsCv.getContext('2d')!;
  const rImg = rCtx.createImageData(ATMO_W, ATMO_H);
  const pImg = pCtx.createImageData(ATMO_W, ATMO_H);
  const rd = rImg.data;
  const pd = pImg.data;

  const sillY = Math.round((SILL_ART * ART) / ATMO_STEP);
  const rayEndY = Math.round((WORLD_H * 0.62) / ATMO_STEP);
  const poolCenterY = Math.round((SILL_ART * ART + 206) / ATMO_STEP);

  for (const wx of WINDOWS) {
    const x0 = Math.round((wx * ART) / ATMO_STEP);
    const x1 = Math.round(((wx + WINDOW_W) * ART) / ATMO_STEP);
    const cx = (x0 + x1) / 2;
    const halfTop = (x1 - x0) / 2 - 8;
    const halfBot = halfTop + 52;

    // 1. Diagonal/splayed pixel-dithered window shafts
    for (let py = sillY; py < rayEndY; py++) {
      const v = (py - sillY) / Math.max(1, rayEndY - sillY);
      const halfSpan = halfTop + (halfBot - halfTop) * v;
      // Vertical fade: bright near sill, dithered fade toward floor
      const vFalloff = (1 - v) * (1 - v * 0.35);
      const minX = Math.max(0, Math.floor(cx - halfSpan));
      const maxX = Math.min(ATMO_W - 1, Math.ceil(cx + halfSpan));
      for (let px = minX; px <= maxX; px++) {
        const dx = Math.abs(px - cx) / Math.max(1, halfSpan);
        if (dx > 1) continue;
        // Inner core beam + outer soft shaft
        const edge = 1 - dx;
        const raw = vFalloff * (edge > 0.45 ? 1.0 : edge / 0.45);
        const bayer = bayerAt(px, py);
        // 3 quantized pixel bands via Bayer threshold
        let alpha = 0;
        if (raw > 0.62 + bayer * 0.24) alpha = 42;
        else if (raw > 0.32 + bayer * 0.28) alpha = 26;
        else if (raw > 0.12 + bayer * 0.24) alpha = 12;
        if (alpha === 0) continue;
        const idx = (py * ATMO_W + px) * 4;
        rd[idx] = 255;
        rd[idx + 1] = 248;
        rd[idx + 2] = 224;
        rd[idx + 3] = Math.min(255, rd[idx + 3] + alpha);
      }
    }

    // 2. Stepped Bayer-dithered floor light pools under each window
    const rx = (x1 - x0) * 0.60;
    const ry = Math.round(104 / ATMO_STEP);
    const minPx = Math.max(0, Math.floor(cx - rx));
    const maxPx = Math.min(ATMO_W - 1, Math.ceil(cx + rx));
    const minPy = Math.max(0, Math.floor(poolCenterY - ry));
    const maxPy = Math.min(ATMO_H - 1, Math.ceil(poolCenterY + ry));
    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const dist = Math.hypot((px - cx) / rx, (py - poolCenterY) / ry);
        if (dist >= 1) continue;
        const raw = 1 - dist;
        const bayer = bayerAt(px, py);
        let alpha = 0;
        if (raw > 0.60 + bayer * 0.22) alpha = 30;
        else if (raw > 0.28 + bayer * 0.26) alpha = 16;
        else if (raw > 0.08 + bayer * 0.22) alpha = 8;
        if (alpha === 0) continue;
        const idx = (py * ATMO_W + px) * 4;
        pd[idx] = 255;
        pd[idx + 1] = 244;
        pd[idx + 2] = 208;
        pd[idx + 3] = Math.min(255, pd[idx + 3] + alpha);
      }
    }
  }

  rCtx.putImageData(rImg, 0, 0);
  pCtx.putImageData(pImg, 0, 0);
  return { rays: Texture.from(raysCv), pools: Texture.from(poolsCv) };
}

/**
 * Reusable 96x64 Bayer-dithered radial glow texture (white, tinted per emitter).
 */
function buildPixelGlowTexture(): Texture {
  const w = 96, h = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dist = Math.hypot((px - w / 2) / (w / 2), (py - h / 2) / (h / 2));
      if (dist >= 1) continue;
      const raw = 1 - dist;
      const bayer = bayerAt(px, py);
      let alpha = 0;
      if (raw > 0.68 + bayer * 0.20) alpha = 86;
      else if (raw > 0.36 + bayer * 0.24) alpha = 44;
      else if (raw > 0.12 + bayer * 0.22) alpha = 18;
      if (alpha === 0) continue;
      const idx = (py * w + px) * 4;
      d[idx] = 255;
      d[idx + 1] = 255;
      d[idx + 2] = 255;
      d[idx + 3] = alpha;
    }
  }
  c.putImageData(img, 0, 0);
  return Texture.from(cv);
}

/**
 * 96x64 Bayer-dithered cutout stamp used to carve warm/cool Pools of Light
 * out of the pixel-grid dark ambient veil.
 */
function buildPixelCutoutCanvas(): HTMLCanvasElement {
  const w = 96, h = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dist = Math.hypot((px - w / 2) / (w / 2), (py - h / 2) / (h / 2));
      if (dist >= 1) continue;
      const raw = 1 - dist;
      const bayer = bayerAt(px, py);
      let alpha = 0;
      if (raw > 0.64 + bayer * 0.18) alpha = 255;
      else if (raw > 0.42 + bayer * 0.22) alpha = 205;
      else if (raw > 0.22 + bayer * 0.24) alpha = 130;
      else if (raw > 0.06 + bayer * 0.20) alpha = 55;
      if (alpha === 0) continue;
      const idx = (py * w + px) * 4;
      d[idx] = 255;
      d[idx + 1] = 255;
      d[idx + 2] = 255;
      d[idx + 3] = alpha;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export class Atmosphere {
  private world = new Container();
  private ambientLayer = new Container();
  private screen = new Container();
  private raysSprite: Sprite;
  private poolsSprite: Sprite;
  private emissiveLayer = new Container();
  private emissivePool: Sprite[] = [];
  private glowTex: Texture;
  private cutoutCanvas: HTMLCanvasElement;
  private darkCanvas: HTMLCanvasElement;
  private darkCtx: CanvasRenderingContext2D;
  private darkTex: Texture;
  private darkSprite: Sprite;
  private darkTimer = 1;
  private lastDarkSig = '';
  private wash = new Graphics();
  private t = 0;
  private w = 0;
  private h = 0;
  /** `prefers-reduced-motion`: freeze the breathe and drop the light strength. */
  private calm = false;
  /** Last wash colour/alpha, so a still frame never rebuilds the same rect. */
  private washKey = '';

  constructor() {
    const lightTex = buildPixelLightTextures();
    this.glowTex = buildPixelGlowTexture();
    this.cutoutCanvas = buildPixelCutoutCanvas();
    this.darkCanvas = document.createElement('canvas');
    this.darkCanvas.width = ATMO_W;
    this.darkCanvas.height = ATMO_H;
    this.darkCtx = this.darkCanvas.getContext('2d')!;
    this.darkCtx.imageSmoothingEnabled = false;
    this.darkTex = Texture.from(this.darkCanvas);
    this.darkSprite = new Sprite(this.darkTex);
    this.darkSprite.width = WORLD_W;
    this.darkSprite.height = WORLD_H;
    this.darkSprite.visible = false;

    this.poolsSprite = new Sprite(lightTex.pools);
    this.poolsSprite.width = WORLD_W;
    this.poolsSprite.height = WORLD_H;
    this.raysSprite = new Sprite(lightTex.rays);
    this.raysSprite.width = WORLD_W;
    this.raysSprite.height = WORLD_H;
  }

  setCalm(v: boolean) { this.calm = v; }

  mountWorld(root: Container, beforeSort: Container, beforeLabels?: Container) {
    this.world.eventMode = 'none';
    this.emissiveLayer.eventMode = 'none';
    this.ambientLayer.eventMode = 'none';
    this.world.addChild(this.poolsSprite, this.emissiveLayer, this.raysSprite);
    const atSort = root.getChildIndex(beforeSort);
    root.addChildAt(this.world, atSort >= 0 ? atSort : root.children.length);
    this.ambientLayer.addChild(this.darkSprite);
    const atLabels = beforeLabels ? root.getChildIndex(beforeLabels) : -1;
    root.addChildAt(this.ambientLayer, atLabels >= 0 ? atLabels : root.children.length);
  }

  mountScreen(stage: Container) {
    this.screen.eventMode = 'none';
    this.screen.addChild(this.wash);
    stage.addChild(this.screen);
  }

  resize(width: number, height: number) {
    this.w = width; this.h = height;
    // The wash rect is screen-sized, so a resize must invalidate the cached key.
    this.washKey = '';
  }

  private redrawDarkAmbient(lights: EmissiveLight[], day: Daylight) {
    const c = this.darkCtx;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#070918';
    c.fillRect(0, 0, ATMO_W, ATMO_H);
    c.globalCompositeOperation = 'destination-out';

    // Subtle moonlight pools beneath the 3 north windows at night/dusk
    const winCut = day.night ? 0.36 : 0.48;
    for (const wx of WINDOWS) {
      const cx = (wx + WINDOW_W / 2) * ART;
      const cy = SILL_ART * ART + 150;
      const rw = WINDOW_W * ART * 0.95;
      const rh = 340;
      c.globalAlpha = winCut;
      c.drawImage(
        this.cutoutCanvas,
        Math.round((cx - rw / 2) / ATMO_STEP),
        Math.round((cy - rh / 2) / ATMO_STEP),
        Math.round(rw / ATMO_STEP),
        Math.round(rh / ATMO_STEP),
      );
    }

    // Carve warm lamp & cool monitor/hardware Pools of Light
    for (const light of lights) {
      const strength = light.cutout ?? Math.min(0.95, light.intensity * 1.15);
      if (strength <= 0.02) continue;
      const rw = light.w * 1.32;
      const rh = light.h * 1.32;
      c.globalAlpha = Math.min(1, strength);
      c.drawImage(
        this.cutoutCanvas,
        Math.round((light.x - rw / 2) / ATMO_STEP),
        Math.round((light.y - rh / 2) / ATMO_STEP),
        Math.round(rw / ATMO_STEP),
        Math.round(rh / ATMO_STEP),
      );
    }
    this.darkTex.source.update();
  }

  update(dt: number, state: AtmosphereState) {
    if (!this.calm) this.t += dt;
    const busy = Math.min(1, state.working / 6);
    const breathe = 0.72 + 0.28 * Math.sin(this.t * 0.55);
    const day = state.daylight;
    const strength = day.rayScale * (0.42 + 0.30 * breathe) + busy * 0.35;

    // Tint pixel shafts & floor pools by time of day so moonlight/sunset read true.
    const shaftTint = day.night
      ? 0x9bb8ff
      : day.key === 'dusk'
        ? 0xffb380
        : day.key === 'dawn'
          ? 0xffd5a8
          : 0xfff5d6;
    this.raysSprite.tint = shaftTint;
    this.poolsSprite.tint = shaftTint;
    this.raysSprite.alpha = Math.min(1, strength * 0.95);
    this.poolsSprite.alpha = Math.min(1, strength * 1.15);

    // Local emissive pixel pools (lamps, monitors, NOC racks, CRAC, pantry)
    const lights = state.lights ?? [];
    const nightBoost = day.night ? 1.15 : day.key === 'dusk' ? 0.78 : day.key === 'dawn' ? 0.50 : 0.22;
    while (this.emissivePool.length < lights.length) {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      this.emissiveLayer.addChild(s);
      this.emissivePool.push(s);
    }
    for (let i = 0; i < this.emissivePool.length; i++) {
      const sprite = this.emissivePool[i];
      if (i >= lights.length) {
        sprite.visible = false;
        continue;
      }
      const light = lights[i];
      const pulse =
        light.pulse && !this.calm ? 0.86 + 0.14 * Math.sin(this.t * light.pulse + i * 1.3) : 1;
      sprite.visible = true;
      sprite.position.set(Math.round(light.x), Math.round(light.y));
      sprite.width = light.w;
      sprite.height = light.h;
      sprite.tint = light.color;
      sprite.alpha = Math.min(1, light.intensity * nightBoost * pulse);
    }

    // Moody Dark Ambient Veil with carved Pools of Light (active at night, soft at dusk/dawn when enabled)
    const moodyEnabled = state.moodyLighting ?? true;
    const darkAlpha = moodyEnabled ? day.ambientDark : 0;
    this.darkSprite.visible = darkAlpha > 0.01;
    if (this.darkSprite.visible) {
      this.darkSprite.alpha = darkAlpha;
      this.darkTimer += dt;
      const sig = `${day.key}:${lights.length}:${lights.map((l) => `${Math.round(l.x)},${Math.round(l.y)},${Math.round((l.cutout ?? l.intensity) * 10)}`).join('|')}`;
      if (sig !== this.lastDarkSig || this.darkTimer >= 0.25) {
        this.lastDarkSig = sig;
        this.darkTimer = 0;
        this.redrawDarkAmbient(lights, day);
      }
    }

    // Screen colour wash follows the clock curve.
    const key = `${day.tint}:${day.tintAlpha}`;
    if (key !== this.washKey) {
      this.washKey = key;
      this.wash.clear();
      this.wash.rect(0, 0, this.w, this.h).fill({ color: day.tint, alpha: day.tintAlpha });
    }
  }
}
