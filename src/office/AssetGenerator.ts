/**
 * All pixel art is generated here programmatically (Canvas 2D -> Texture).
 * Image unit = "pixel art"; sprites are scaled 2x on screen with nearest filter.
 *
 * Every canvas is authored at `DENSITY` times the art-pixel grid and the 2D
 * context is scaled by the same factor, so all drawing code keeps using
 * art-pixel coordinates while the texture holds `DENSITY` texels per art pixel.
 * Sprites are then drawn at `ART / DENSITY` (props: `PROP / DENSITY`) screen px
 * per texel, which keeps the on-screen size identical and only raises the art
 * resolution. One texel (`TEXEL`) is half an art pixel, so outlines, bevels and
 * dither dots land on the 1 screen px grid at 1x zoom instead of the 2 px block
 * grid the old art was locked to.
 */
import { Texture } from 'pixi.js';
import { ART, COLS, DENSITY, RACK_BLINK_BASE, RACK_BLINK_MAX, RACK_BLINK_STEP, RACK_COLS, RACK_ROWS, ROWS, TILE } from '../constants';

export type FloorStyle = 'oak' | 'walnut' | 'herringbone' | 'slate' | 'grid';
export const FLOOR_STYLES: readonly FloorStyle[] = ['oak', 'walnut', 'herringbone', 'slate', 'grid'];
export const FLOOR_STYLE_LABEL: Record<FloorStyle, string> = {
  oak: 'Warm Oak',
  walnut: 'Dark Walnut',
  herringbone: 'Herringbone',
  slate: 'Slate Check',
  grid: 'Light Grid',
};

export type PlantStyle = 'classic' | 'monstera' | 'palm' | 'bonsai' | 'cactus' | 'mixed';
export type ConcretePlantStyle = Exclude<PlantStyle, 'mixed'>;
export const PLANT_STYLES: readonly PlantStyle[] = ['classic', 'monstera', 'palm', 'bonsai', 'cactus', 'mixed'];
export const PLANT_STYLE_LABEL: Record<PlantStyle, string> = {
  classic: 'Classic Bush',
  monstera: 'Monstera',
  palm: 'Areca Palm',
  bonsai: 'Zen Bonsai',
  cactus: 'Desert Cactus',
  mixed: 'Assorted Mix',
};

const OL = '#1d1722';
// Semi-transparent glass partitions: pane tint keeps floor visible through the texture.
const GLASS_TINT = 'rgba(150,214,224,0.34)';
const GLASS_SHEEN = 'rgba(226,252,255,0.46)';
const GLASS_SPARK = 'rgba(255,255,255,0.62)';
const FRAME_DARK = 'rgba(52,55,70,0.92)';
const FRAME_EDGE = 'rgba(122,132,151,0.85)';
const FRAME_LIGHT = 'rgba(84,90,110,0.95)';
type Ctx = CanvasRenderingContext2D;
export type LampType = 'floorLamp' | 'deskLamp' | 'wallSconce';
export type FurnitureType =
  | 'desk' | 'chairUp' | 'chairDown' | 'sofa3Down' | 'sofa2Up' | 'coffeeTable' | 'plant' | 'whiteboard'
  | 'meetingTable' | 'diningTable' | 'bookshelf' | 'cabinet' | 'fridge' | 'dispenser' | 'storageTable'
  | 'serverRack' | 'crac' | 'ups' | 'switchBox'
  | LampType
  | 'partitionH' | 'partitionV' | 'partitionHHalf' | 'partitionCorner' | 'doorH' | 'doorV';
export type LookAccessory = 'none' | 'glasses' | 'headset';
export type LookHair = 'none' | 'flat' | 'spike' | 'side' | 'cap';
export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  accessory?: LookAccessory;
  hairStyle?: LookHair;
}
type D3 = 'up' | 'down' | 'left' | 'right';
export interface CharFrames {
  idle: Record<D3, Texture[]>;
  walk: Record<D3, Texture[]>;
  sit: { up: Texture[]; down: Texture[] };
}
export interface Assets {
  background: Texture;
  furn: Record<FurnitureType, Texture>;
  plantVariants: Record<ConcretePlantStyle, Texture>;
  lampOn: Record<LampType, Texture>;
  lampOff: Record<LampType, Texture>;
  bubble: Texture;
  /** Workstation monitor screen, lit and still: a `ready` agent sits there. */
  monitorOn: Texture;
  /** Workstation monitor screens, animated: a `working` agent sits there. */
  monitorWorking: Texture[];
  /** Workstation monitor screen, grey with pause bars: a `blocked` agent waits there. */
  monitorWaiting: Texture;
  /** Workstation monitor screen, dark: no working/ready/blocked agent at that desk. */
  monitorOff: Texture;
  chars: CharFrames[];
}

const R = (c: Ctx, col: string, x: number, y: number, w: number, h: number) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
/** One texel in art-px units: half an art pixel = 1 screen px at `ART = 2`. */
const TEXEL = 1 / DENSITY;
const B = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { R(c, OL, x, y, w, h); R(c, col, x + TEXEL, y + TEXEL, w - 2 * TEXEL, h - 2 * TEXEL); };
// ---------- 32-bit shading kit ----------
// Silhouettes and sprite sizes never change: the extra depth comes from bevel
// edges, ordered dithering and a baked contact shade, the way high-resolution
// pixel art ramps a palette instead of adding geometry.
const HI = 'rgba(255,246,222,0.18)';
const SH = 'rgba(16,10,26,0.22)';
const CONTACT = 'rgba(10,6,16,0.30)';
/** 1-texel checkerboard dither that blends one tone into another. */
const dither = (c: Ctx, col: string, x: number, y: number, w: number, h: number, step = DENSITY) => {
  c.fillStyle = col;
  const tw = Math.round(w * DENSITY), th = Math.round(h * DENSITY);
  for (let py = 0; py < th; py++)
    for (let px = py % step === 0 ? 0 : 1; px < tw; px += step) c.fillRect(x + px * TEXEL, y + py * TEXEL, TEXEL, TEXEL);
};
/** Outlined panel with a lit top-left edge and a shaded bottom-right edge. */
const P = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  B(c, x, y, w, h, col);
  if (w < 4 || h < 4) return;
  const t = TEXEL, e = 2 * TEXEL;
  R(c, HI, x + t, y + t, w - 3 * t, t);
  R(c, HI, x + t, y + e, t, h - 5 * t);
  R(c, SH, x + e, y + h - 2 * t, w - 3 * t, t);
  R(c, SH, x + w - 2 * t, y + t, t, h - 3 * t);
};
/** Contact shade so a prop sits on the floor instead of floating above it. */
const cs = (c: Ctx, x: number, y: number, w: number) => {
  const t = TEXEL;
  R(c, CONTACT, x, y, w, t);
  R(c, 'rgba(10,6,16,0.16)', x + t, y + t, Math.max(t, w - 2 * t), t);
};
/**
 * Deterministic surface grain: short two-tone speckles so a large flat top
 * reads as material instead of a solid fill. One texel tall, so it never
 * changes a sprite size or a silhouette.
 */
const grain = (
  c: Ctx,
  rnd: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  dark: string,
  light: string,
  dots: number,
) => {
  for (let i = 0; i < dots; i++) {
    const gx = x + Math.floor(rnd() * Math.max(1, w - 2));
    const gy = y + Math.floor(rnd() * Math.max(1, h));
    R(c, rnd() < 0.5 ? dark : light, gx, gy, 1 + Math.floor(rnd() * 2), 1);
  }
};
/** Specular streak: a short bright run that sells a polished or lit surface. */
const sheen = (c: Ctx, x: number, y: number, w: number, alpha = 0.12) => {
  R(c, `rgba(255,246,222,${alpha})`, x, y, w, TEXEL);
};
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function make(w: number, h: number, draw: (c: Ctx) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w * DENSITY; cv.height = h * DENSITY;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.scale(DENSITY, DENSITY);
  draw(c);
  return Texture.from(cv);
}

// ---------- Background: wooden floor, walls, window + skyline, clock, rugs, light ----------
const F = { a: '#b07a4a', b: '#a56f42', c: '#bb8556', line: '#8c5d36' };
function windowPane(c: Ctx, x: number, y: number, w: number, h: number, night: boolean, rnd: () => number) {
  B(c, x, y, w, h, '#5a5f73');
  const gx = x + 3, gy = y + 3, gw = w - 6, gh = h - 6;
  const sky = night ? ['#10142f', '#161b40', '#1d2350', '#262d63', '#303874', '#3a4385']
    : ['#5aa9e0', '#6db5e6', '#82c1ea', '#9acdee', '#b3d9f1', '#cbe5f4'];
  const bandH = Math.ceil(gh / sky.length);
  sky.forEach((col, i) => {
    const by = gy + Math.floor((gh / sky.length) * i);
    R(c, col, gx, by, gw, bandH);
    if (i > 0) dither(c, col, gx, by - 1, gw, 1);
  });
  if (night) {
    for (let i = 0; i < 22; i++) R(c, i % 5 === 0 ? '#fff6d6' : '#dfe6ff', gx + Math.floor(rnd() * gw), gy + Math.floor(rnd() * gh * 0.5), 1, 1);
    if (x === 336) {
      // Pixel crescent moon in center window at night
      R(c, '#fff2b8', gx + 44, gy + 7, 5, 5);
      R(c, sky[1], gx + 46, gy + 7, 4, 4);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const cx = gx + Math.floor(rnd() * (gw - 24)), cy = gy + 4 + Math.floor(rnd() * 12);
      R(c, '#fff', cx, cy, 16, 3); R(c, '#fff', cx + 4, cy - 2, 8, 2);
      R(c, 'rgba(140,180,220,0.45)', cx + 1, cy + 2, 14, 1);
    }
  }
  let bx = gx;
  while (bx < gx + gw) {
    const bw = Math.min(6 + Math.floor(rnd() * 12), gx + gw - bx), bh = 10 + Math.floor(rnd() * 30);
    const col = night ? ['#141830', '#1a1f3d', '#202647'][Math.floor(rnd() * 3)] : ['#6f8aa6', '#7d97b0', '#8aa3ba'][Math.floor(rnd() * 3)];
    R(c, col, bx, gy + gh - bh, bw, bh);
    R(c, night ? 'rgba(255,246,222,0.06)' : 'rgba(255,255,255,0.16)', bx, gy + gh - bh, bw, TEXEL);
    for (let yy = gy + gh - bh + 2; yy < gy + gh - 2; yy += 4)
      for (let xx = bx + 1; xx < bx + bw - 1; xx += 3)
        if (rnd() < 0.35) R(c, night ? '#ffd76a' : '#bcd4ea', xx, yy, 1, 2);
    bx += bw;
  }
  // Stepped diagonal pixel glass sheen across panes
  for (let p = 0; p < 4; p++) {
    const px0 = gx + Math.round((gw * p) / 4) + 6;
    for (let sy = 0; sy < gh - 4; sy += 2) {
      const sx = px0 + Math.floor(sy * 0.45);
      if (sx + 4 < gx + Math.round((gw * (p + 1)) / 4)) {
        R(c, 'rgba(255,255,255,0.09)', sx, gy + 2 + sy, 3, 1);
        R(c, 'rgba(255,255,255,0.05)', sx + 8, gy + 2 + sy, 1, 1);
      }
    }
  }
  for (let i = 1; i < 4; i++) R(c, '#5a5f73', gx + Math.round((gw * i) / 4), gy, 2, gh);
  B(c, x - 2, y + h, w + 4, 3, '#6b6f85');
  R(c, 'rgba(255,246,222,0.18)', x - 1, y + h + TEXEL, w + 2, TEXEL);
}
function rug(c: Ctx, tx: number, ty: number, tw: number, th: number, main: string, accent: string) {
  const x = tx * 16, y = ty * 16, w = tw * 16, h = th * 16;
  // Subtle contact drop shadow and 1-texel woven edge fringe.
  R(c, 'rgba(10,6,16,0.22)', x + TEXEL, y + h, w, TEXEL);
  R(c, 'rgba(10,6,16,0.16)', x + w, y + TEXEL, TEXEL, h);
  for (let fy = y + 2; fy < y + h - 2; fy += 2) {
    R(c, accent, x - 1, fy, 1, TEXEL);
    R(c, accent, x + w, fy, 1, TEXEL);
  }
  B(c, x, y, w, h, accent);
  R(c, main, x + 3, y + 3, w - 6, h - 6);
  dither(c, accent, x + 3, y + 3, w - 6, 2);
  dither(c, accent, x + 3, y + h - 5, w - 6, 2);
  for (let i = 0; i < w - 12; i += 8) for (let j = 0; j < h - 12; j += 8) if (((i + j) / 8) % 2 === 0) R(c, accent, x + 6 + i, y + 6 + j, 4, 4);
  // Inner keyline reads as a woven border, not a flat rectangle.
  R(c, 'rgba(255,246,222,0.12)', x + 4, y + 4, w - 8, 1);
  R(c, 'rgba(16,10,26,0.20)', x + 4, y + h - 5, w - 8, 1);
}
export function makeBackground(night: boolean, floor: FloorStyle = 'oak'): Texture {
  const W = COLS * 16, H = ROWS * 16;
  return make(W, H, (c) => {
    const rnd = rng(7);
    R(c, '#14121c', 0, 0, W, H);
    if (floor === 'walnut') {
      const WALNUT = ['#734c31', '#68432a', '#7c5337', '#6d482e', '#5f3c25'];
      for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        const x = tx * 16, y = ty * 16;
        const base = WALNUT[Math.floor(rnd() * WALNUT.length)];
        R(c, base, x, y, 16, 16);
        dither(c, 'rgba(42,24,14,0.42)', x, y + 13, 16, 3);
        R(c, '#4d2f1b', x, y + 15, 16, 1);
        R(c, '#8c5f3f', x + 1, y, 14, 1);
        for (let p = 0; p < 16; p++) if ((tx * 16 + p + ty * 19) % 48 === 0) R(c, '#4d2f1b', x + p, y, 1, 15);
        if (rnd() < 0.45) R(c, '#8a5d3d', x + Math.floor(rnd() * 13), y + 2 + Math.floor(rnd() * 11), 2, 1);
        if (rnd() < 0.35) R(c, '#52321e', x + Math.floor(rnd() * 13), y + 2 + Math.floor(rnd() * 11), 1, 2);
      }
    } else if (floor === 'herringbone') {
      const PARQUET = ['#b68052', '#a67042', '#c28c5c', '#9d683b'];
      for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        const x = tx * 16, y = ty * 16;
        const horiz = (tx + ty) % 2 === 0;
        const c1 = PARQUET[(tx * 3 + ty) % PARQUET.length];
        const c2 = PARQUET[(tx + ty * 3 + 1) % PARQUET.length];
        if (horiz) {
          R(c, c1, x, y, 16, 8); R(c, c2, x, y + 8, 16, 8);
          R(c, '#cf9a68', x + 1, y + TEXEL, 14, TEXEL);
          R(c, '#cf9a68', x + 1, y + 8 + TEXEL, 14, TEXEL);
          R(c, '#8c5d36', x, y + 7.5, 16, TEXEL);
          R(c, '#8c5d36', x, y + 15.5, 16, TEXEL);
          R(c, '#8c5d36', x + 15.5, y, TEXEL, 16);
          dither(c, 'rgba(120,76,40,0.28)', x, y + 6, 16, 2);
          dither(c, 'rgba(120,76,40,0.28)', x, y + 14, 16, 2);
        } else {
          R(c, c1, x, y, 8, 16); R(c, c2, x + 8, y, 8, 16);
          R(c, '#cf9a68', x + TEXEL, y + 1, TEXEL, 14);
          R(c, '#cf9a68', x + 8 + TEXEL, y + 1, TEXEL, 14);
          R(c, '#8c5d36', x + 7.5, y, TEXEL, 16);
          R(c, '#8c5d36', x + 15.5, y, TEXEL, 16);
          R(c, '#8c5d36', x, y + 15.5, 16, TEXEL);
          dither(c, 'rgba(120,76,40,0.28)', x + 6, y, 2, 16);
          dither(c, 'rgba(120,76,40,0.28)', x + 14, y, 2, 16);
        }
        if (rnd() < 0.35) R(c, '#8c5d36', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), 2, 1);
      }
    } else if (floor === 'slate') {
      const SLATE_A = ['#4a5162', '#454c5c', '#4f5668'];
      const SLATE_B = ['#3f4554', '#3b414f', '#444b5b'];
      for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        const x = tx * 16, y = ty * 16;
        const pal = (tx + ty) % 2 === 0 ? SLATE_A : SLATE_B;
        const base = pal[Math.floor(rnd() * pal.length)];
        R(c, base, x, y, 16, 16);
        R(c, '#2d323e', x, y + 15.5, 16, TEXEL);
        R(c, '#2d323e', x + 15.5, y, TEXEL, 16);
        R(c, 'rgba(255,246,222,0.08)', x + TEXEL, y + TEXEL, 14, TEXEL);
        R(c, 'rgba(255,246,222,0.05)', x + TEXEL, y + TEXEL, TEXEL, 14);
        dither(c, 'rgba(24,28,38,0.26)', x + 1, y + 13, 14, 2);
        if (rnd() < 0.45) R(c, 'rgba(255,255,255,0.05)', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), 1, 1);
        if (rnd() < 0.40) R(c, 'rgba(16,18,26,0.22)', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), 2, 1);
      }
    } else if (floor === 'grid') {
      const GRID_A = ['#cdd3dc', '#cbd1da', '#d0d6df'];
      const GRID_B = ['#c7cdd7', '#cad0d9', '#c4cad4'];
      for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        const x = tx * 16, y = ty * 16;
        const pal = (tx + ty) % 2 === 0 ? GRID_A : GRID_B;
        const base = pal[Math.floor(rnd() * pal.length)];
        R(c, base, x, y, 16, 16);
        // Smooth, low-contrast grout lines & gentle matte top-left edge
        R(c, 'rgba(162,170,184,0.50)', x, y + 15.5, 16, TEXEL);
        R(c, 'rgba(162,170,184,0.50)', x + 15.5, y, TEXEL, 16);
        R(c, 'rgba(236,240,246,0.28)', x, y, 15.5, TEXEL);
        R(c, 'rgba(236,240,246,0.24)', x, y, TEXEL, 15.5);
        dither(c, 'rgba(155,163,178,0.12)', x + 1, y + 13, 14, 2);
        if (rnd() < 0.30) R(c, 'rgba(236,240,246,0.22)', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), 2, TEXEL);
        if (rnd() < 0.25) R(c, 'rgba(152,160,175,0.16)', x + 2 + Math.floor(rnd() * 11), y + 2 + Math.floor(rnd() * 11), 1, 1);
      }
    } else {
      const PLANKS = [F.a, F.b, F.c, '#b8845a', '#9c683c'];
      for (let ty = 5; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
        const x = tx * 16, y = ty * 16;
        const base = PLANKS[Math.floor(rnd() * PLANKS.length)];
        R(c, base, x, y, 16, 16);
        // Dither the tile bottom into the seam tone: plank ramp instead of a hard line.
        dither(c, 'rgba(140,93,54,0.42)', x, y + 13, 16, 3);
        R(c, F.line, x, y + 15, 16, 1);
        R(c, '#c9945f', x + 1, y, 14, 1);
        for (let p = 0; p < 16; p++) if ((tx * 16 + p + ty * 19) % 48 === 0) R(c, F.line, x + p, y, 1, 15);
        if (rnd() < 0.4) R(c, '#c9945f', x + Math.floor(rnd() * 13), y + 2 + Math.floor(rnd() * 11), 2, 1);
        if (rnd() < 0.3) R(c, '#8a5c34', x + Math.floor(rnd() * 13), y + 2 + Math.floor(rnd() * 11), 1, 2);
      }
    }
    // Wall base occlusion: the floor darkens where it meets the wall.
    dither(c, 'rgba(20,14,28,0.20)', 0, 84, W, 6);
    // walls
    const WALL_BANDS = ['#454857', '#40434f', '#3a3d4a', '#353845', '#303340', '#2b2d38'];
    WALL_BANDS.forEach((col, i) => R(c, col, 0, i * 12, W, 12));
    for (let x = 0; x < W; x += 32) R(c, '#343746', x, 0, 1, 72);
    for (let x = 16; x < W; x += 32) R(c, 'rgba(255,246,222,0.05)', x, 0, 1, 70);
    R(c, '#2b2d38', 0, 72, W, 8);
    R(c, '#565b6e', 0, 72, W, 1);
    R(c, 'rgba(255,246,222,0.10)', 0, 73, W, TEXEL);
    R(c, '#22242e', 0, 77, W, 2);
    R(c, OL, 0, 79, W, 1);
    for (const wx of [16, 336, 656]) windowPane(c, wx, 6, 288, 56, night, rnd);
    // wall clock (hands drawn at runtime)
    R(c, OL, 313, 24, 14, 12); R(c, OL, 314, 23, 12, 14); R(c, '#f2ede0', 315, 25, 10, 10); R(c, '#f2ede0', 314, 26, 12, 8);
    R(c, OL, 319, 25, 2, 1); R(c, OL, 319, 34, 2, 1); R(c, OL, 315, 29, 1, 2); R(c, OL, 324, 29, 1, 2);
    // rugs
    rug(c, 2, 7, 10, 6, '#3f7f8c', '#2b5560');
    rug(c, 20, 10, 10, 8, '#6a5a78', '#473c55');
    rug(c, 4, 21.5, 6, 6.5, '#7a8a5a', '#4e5a38');
    // NOC raised floor: 1-tile access panels, every other one perforated for
    // cold-aisle airflow, so the lower-left room reads as a server room.
    //
    // The carpet has to stop exactly on the inner face of each partition, so the
    // field is clipped instead of being counted in whole tiles: a panel is 16
    // art px (one tile) while the glass panes are 8 art px and sit centred on
    // the tile line, which leaves 4 art px of glass on the room side of it.
    // Measured in art px, with 16 art px per tile:
    //   right  = 14.5 * 16 - 4 = 228  (col-14 pane, 8 art px wide, centred)
    //   top    = 30 * 16 + 4   = 484  (row-30 pane, bottom edge 8 world px
    //                                  below the tile line = 4 art px)
    //   bottom = ROWS * 16     = 640  (last floor row: no gap at the edge)
    //   left   = 0                    (open map edge, the NOC has no pane there)
    const TILE_ART = TILE / ART;
    const nocX0 = 0;
    const nocX1 = 14.5 * TILE_ART - 4;
    const nocY0 = 30 * TILE_ART + 4;
    const nocY1 = ROWS * TILE_ART;
    c.save();
    c.beginPath();
    c.rect(nocX0, nocY0, nocX1 - nocX0, nocY1 - nocY0);
    c.clip();
    for (let ty = 30; ty <= ROWS - 1; ty++) {
      for (let tx = 0; tx <= 14; tx++) {
        const x = tx * 16, y = ty * 16;
        B(c, x, y, 16, 16, '#2e3340');
        R(c, '#39404f', x + 1, y + 1, 14, 14);
        R(c, '#252a35', x, y, 16, 1); R(c, '#252a35', x, y, 1, 16);
        R(c, 'rgba(255,246,222,0.05)', x + 1, y + 1, 14, 1);
        if ((tx + ty) % 2 === 0) {
          for (let py = 3; py < 14; py += 3) for (let px = 3; px < 14; px += 3) R(c, '#333a49', x + px, y + py, 1, 1);
          dither(c, 'rgba(20,26,38,0.28)', x + 2, y + 11, 12, 3);
        }
      }
    }
    c.restore();
    // Crisp pixel wall occlusion + dithered window sill bounce (god rays themselves
    // live on the Bayer-dithered Atmosphere layer so no smooth polygon cuts across planks).
    R(c, 'rgba(10,6,16,0.28)', 0, 80, W, 2);
    dither(c, 'rgba(10,6,16,0.16)', 0, 82, W, 3);
    const sillTint = night ? 'rgba(120,150,255,0.08)' : 'rgba(255,244,208,0.12)';
    for (const wx of [16, 336, 656]) dither(c, sillTint, wx + 8, 83, 272, 10);
  });
}

// ---------- Furniture ----------
function sofa(w: number, up: boolean, dark: string, light: string, hi: string): Texture {
  return make(w, 26, (c) => {
    const n = w > 40 ? 3 : 2, step = (w - 8) / n;
    const rnd = rng(w * 31 + (up ? 7 : 3));
    if (!up) {
      P(c, 0, 0, w, 13, dark); R(c, hi, 2, 1, w - 4, 1); dither(c, dark, 2, 10, w - 4, 3);
      grain(c, rnd, 3, 2, w - 6, 5, 'rgba(10,6,16,0.20)', hi, Math.round(w * 0.5));
      P(c, 4, 9, w - 8, 13, light); dither(c, dark, 5, 19, w - 10, 3);
      grain(c, rnd, 5, 11, w - 10, 6, dark, hi, Math.round(w * 0.4));
      for (let i = 1; i < n; i++) R(c, dark, 4 + Math.round(step * i), 10, 1, 11);
      P(c, 0, 6, 6, 17, dark); P(c, w - 6, 6, 6, 17, dark);
      R(c, hi, 1, 7, 4, TEXEL); R(c, hi, w - 5, 7, 4, TEXEL);
      R(c, OL, 2, 23, 3, 3); R(c, OL, w - 5, 23, 3, 3);
      cs(c, 2, 25, w - 4);
    } else {
      P(c, 0, 2, 6, 18, dark); P(c, w - 6, 2, 6, 18, dark);
      R(c, hi, 1, 3, 4, TEXEL); R(c, hi, w - 5, 3, 4, TEXEL);
      P(c, 4, 2, w - 8, 14, light); dither(c, dark, 5, 13, w - 10, 3);
      grain(c, rnd, 5, 3, w - 10, 7, dark, hi, Math.round(w * 0.4));
      for (let i = 1; i < n; i++) R(c, dark, 4 + Math.round(step * i), 3, 1, 12);
      P(c, 0, 13, w, 13, dark); R(c, hi, 2, 14, w - 4, 1); dither(c, 'rgba(10,6,16,0.20)', 2, 23, w - 4, 3);
      cs(c, 1, 25, w - 2);
    }
  });
}
function makeLampTexture(kind: LampType, lit: boolean): Texture {
  if (kind === 'floorLamp') {
    return make(8, 24, (c) => {
      // Weighted dark-bronze circular base + contact shadow
      P(c, 1.5, 21, 5, 2, '#3a322d'); R(c, '#6b5744', 2, 21, 4, TEXEL);
      cs(c, 1.5, 23, 5);
      // Slender matte iron / brushed brass stem
      R(c, OL, 3.5, 8, 1, 13);
      R(c, lit ? '#8f7248' : '#565c6e', 3.5, 8, TEXEL, 13);
      // Drum lampshade
      const shade = lit ? '#f7cf7c' : '#d6cfc0';
      const inner = lit ? '#fff2bd' : '#e6e0d4';
      const rim = lit ? '#b57b38' : '#857e72';
      P(c, 1, 1, 6, 7, shade);
      R(c, rim, 1.5, 1, 5, 1);
      R(c, inner, 2, 2, 4, 4.5);
      R(c, lit ? '#ffdf8c' : '#c2bba8', 2, 6, 4, 1);
      if (lit) {
        // Warm glow spill below & around shade
        R(c, 'rgba(255,214,120,0.45)', 0.5, 2, TEXEL, 5);
        R(c, 'rgba(255,214,120,0.45)', 7, 2, TEXEL, 5);
        R(c, 'rgba(255,232,160,0.55)', 2, 7.5, 4, 1);
      }
    });
  }
  if (kind === 'deskLamp') {
    return make(12, 14, (c) => {
      // Weighted desk base + articulated brass arm + angled hood
      P(c, 5, 11, 6, 2, '#3b4052'); R(c, '#6a738f', 6, 11, 4, TEXEL);
      R(c, OL, 8, 5, 1.5, 6); R(c, '#9e8052', 8.5, 5, TEXEL, 6);
      R(c, OL, 4, 3, 5, 1.5); R(c, '#b8945e', 4.5, 3, 4, TEXEL);
      // Angled studio shade pointing down-left toward workspace
      P(c, 1, 2, 5, 4, lit ? '#474e63' : '#50566b');
      R(c, '#8a94ad', 2, 2.5, 3, TEXEL);
      R(c, lit ? '#ffe89c' : '#c9c4b8', 1.5, 5.5, 4, 1);
      if (lit) {
        R(c, 'rgba(255,220,130,0.52)', 1, 6.5, 5, 2);
        R(c, 'rgba(255,220,130,0.28)', 0.5, 8.5, 5.5, 2);
      }
    });
  }
  // wallSconce (12 x 16)
  return make(12, 16, (c) => {
    // Wall mounting bracket
    P(c, 4, 5, 4, 6, '#3a3f50'); R(c, '#6c748c', 4.5, 5.5, 3, TEXEL);
    // Upper/lower translucent frosted sconce diffuser
    P(c, 3, 2, 6, 5, lit ? '#ffd984' : '#cbd1dc');
    R(c, lit ? '#fff5c4' : '#e4e8f0', 4, 3, 4, 3);
    R(c, '#495063', 3, 6.5, 6, 1);
    if (lit) {
      R(c, 'rgba(255,212,120,0.45)', 2, 1, 8, 1);
      R(c, 'rgba(255,212,120,0.36)', 2.5, 8, 7, 3);
      R(c, 'rgba(255,212,120,0.18)', 2, 11, 8, 3);
    }
  });
}

function makeFurniture(
  plant: Texture,
  lamps: Record<LampType, Texture>,
): Record<FurnitureType, Texture> {
  const rnd = rng(21);
  return {
    desk: make(32, 28, (c) => {
      P(c, 0, 12, 32, 9, '#a8744a'); R(c, '#c18c5e', 1, 13, 30, 1); dither(c, '#8f5f3a', 1, 18, 30, 3);
      grain(c, rnd, 2, 14, 28, 4, 'rgba(140,93,54,0.40)', 'rgba(255,246,222,0.10)', 22);
      sheen(c, 2, 13, 18, 0.14);
      R(c, '#2b2f3a', 10, 15, 10, 3); R(c, '#555a6b', 11, 16, 8, 1); R(c, '#2b2f3a', 23, 15, 3, 3); R(c, '#e8e0d0', 3, 14, 3, 4);
      P(c, 0, 20, 32, 8, '#6b4429'); R(c, '#8a5a34', 2, 22, 12, 4); R(c, OL, 7, 23, 2, 1);
      R(c, HI, 1, 21, 30, 1); cs(c, 1, 26, 30);
    }),
    chairUp: make(16, 16, (c) => {
      P(c, 2, 0, 12, 9, '#4b5178'); P(c, 3, 8, 10, 5, '#3a3f5c'); R(c, OL, 6, 13, 4, 2); R(c, OL, 3, 15, 4, 1); R(c, OL, 9, 15, 4, 1);
      // 32-bit armrest pads & lumbar stitch
      R(c, '#25283a', 1, 5, 2, 5); R(c, '#636a96', 1, 5, 2, TEXEL);
      R(c, '#25283a', 13, 5, 2, 5); R(c, '#636a96', 13, 5, 2, TEXEL);
      R(c, 'rgba(255,246,222,0.16)', 3, 1, 10, 1); cs(c, 3, 14, 10);
    }),
    chairDown: make(16, 16, (c) => {
      P(c, 3, 0, 10, 5, '#3a3f5c'); P(c, 2, 4, 12, 9, '#4b5178'); R(c, OL, 6, 13, 4, 2); R(c, OL, 3, 15, 4, 1); R(c, OL, 9, 15, 4, 1);
      R(c, '#25283a', 1, 4, 2, 5); R(c, '#636a96', 1, 4, 2, TEXEL);
      R(c, '#25283a', 13, 4, 2, 5); R(c, '#636a96', 13, 4, 2, TEXEL);
      R(c, 'rgba(255,246,222,0.16)', 3, 5, 10, 1); cs(c, 3, 14, 10);
    }),
    sofa3Down: sofa(48, false, '#2f6670', '#3f8795', '#57a5b3'),
    sofa2Up: sofa(32, true, '#7a4455', '#9c5a6e', '#b87388'),
    coffeeTable: make(32, 16, (c) => {
      P(c, 1, 3, 30, 9, '#a8744a'); R(c, '#c18c5e', 2, 4, 28, 1);
      grain(c, rnd, 3, 5, 26, 3, 'rgba(140,93,54,0.36)', 'rgba(255,246,222,0.09)', 14);
      sheen(c, 3, 4, 14, 0.13);
      P(c, 3, 11, 3, 5, '#6b4429'); P(c, 26, 11, 3, 5, '#6b4429');
      // Magazine/book stack + coffee cup on saucer with coffee surface
      R(c, '#c05a4a', 6, 5, 7, 4); R(c, '#e8e0d0', 7, 6, 4, 1);
      R(c, '#b7bec9', 19, 6, 5, 3); R(c, '#e8e0d0', 20, 5, 3, 3); R(c, '#4b2e1e', 20.5, 5.5, 2, 1);
      cs(c, 2, 14, 28);
    }),
    plant,
    whiteboard: make(64, 52, (c) => {
      P(c, 0, 0, 64, 38, '#e9edf2'); R(c, '#c7ccd6', 0, 37, 64, 1);
      dither(c, 'rgba(160,170,190,0.20)', 1, 32, 62, 5);
      R(c, '#d9534f', 5, 6, 24, 1); R(c, '#4f86c6', 5, 10, 40, 1); R(c, '#4f86c6', 5, 13, 30, 1);
      R(c, '#d9a441', 12, 16, 10, 1); R(c, '#5aa469', 40, 15, 18, 10); R(c, '#e9edf2', 41, 16, 16, 8); R(c, '#2b2f3a', 5, 19, 20, 1);
      R(c, '#8c8f99', 8, 25, 16, 1); R(c, '#8c8f99', 34, 23, 20, 1); R(c, '#8c8f99', 8, 30, 22, 1);
      B(c, 8, 38, 3, 14, '#555a6b'); B(c, 53, 38, 3, 14, '#555a6b');
      cs(c, 6, 51, 52);
    }),
    // Pantry dining table: 4 seat settings on a 4-tile top, so its footprint
    // matches the 8-seat meeting table's per-seat scale without overhanging.
    diningTable: make(32, 20, (c) => {
      P(c, 0, 4, 32, 10, '#a8744a'); R(c, '#c18c5e', 1, 5, 30, 1); dither(c, '#8f5f3a', 1, 11, 30, 3);
      grain(c, rnd, 2, 6, 28, 3, 'rgba(140,93,54,0.38)', 'rgba(255,246,222,0.09)', 16);
      sheen(c, 2, 5, 16, 0.13);
      R(c, '#8a5a34', 2, 10, 28, 2);
      R(c, '#e8e0d0', 5, 7, 6, 3); R(c, '#e8e0d0', 21, 7, 6, 3);
      R(c, '#4f86c6', 13, 8, 3, 2); R(c, '#d9a441', 17, 8, 3, 2);
      P(c, 1, 14, 30, 4, '#6b4429'); P(c, 3, 18, 4, 2, '#6b4429'); P(c, 25, 18, 4, 2, '#6b4429');
      cs(c, 2, 19, 28);
    }),
    meetingTable: make(64, 36, (c) => {
      P(c, 0, 2, 64, 27, '#a8744a'); R(c, '#c18c5e', 2, 3, 60, 1); dither(c, '#8f5f3a', 1, 24, 62, 4);
      grain(c, rnd, 3, 4, 58, 5, 'rgba(140,93,54,0.36)', 'rgba(255,246,222,0.09)', 40);
      sheen(c, 4, 3, 30, 0.13);
      P(c, 2, 28, 60, 6, '#6b4429'); P(c, 4, 33, 4, 3, '#6b4429'); P(c, 56, 33, 4, 3, '#6b4429');
      P(c, 10, 8, 10, 6, '#2b2f3a'); R(c, '#4aa3d8', 11, 9, 8, 3); dither(c, '#6fc0e8', 11, 11, 8, 2);
      P(c, 44, 8, 10, 6, '#2b2f3a'); R(c, '#4aa3d8', 45, 9, 8, 3); dither(c, '#6fc0e8', 45, 11, 8, 2);
      R(c, '#e9edf2', 28, 12, 8, 6); R(c, '#e8e0d0', 24, 18, 3, 3); R(c, '#e8e0d0', 40, 19, 3, 3);
      cs(c, 2, 35, 60);
    }),
    bookshelf: make(32, 44, (c) => {
      P(c, 0, 0, 32, 44, '#6b4429');
      const cols = ['#c05a4a', '#4f86c6', '#d9a441', '#5aa469', '#8a6fc6', '#e8e0d0'];
      for (let i = 0; i < 3; i++) {
        R(c, '#2b1d14', 2, 2 + i * 14, 28, 12);
        dither(c, 'rgba(0,0,0,0.30)', 2, 9 + i * 14, 28, 5);
        for (let x = 3; x < 28;) { const bw = 2 + Math.floor(rnd() * 3), bh = 7 + Math.floor(rnd() * 4); R(c, cols[Math.floor(rnd() * cols.length)], x, 14 + i * 14 - bh, bw, bh); x += bw + 1; }
        R(c, '#8a5a34', 2, 13 + i * 14, 28, 2);
      }
      cs(c, 1, 43, 30);
    }),
    cabinet: make(16, 36, (c) => {
      P(c, 0, 0, 16, 36, '#6c7284'); P(c, 2, 2, 12, 14, '#8a91a6'); P(c, 2, 19, 12, 14, '#8a91a6');
      dither(c, '#5a6072', 3, 12, 10, 3); dither(c, '#5a6072', 3, 29, 10, 3);
      R(c, OL, 6, 15, 4, 1); R(c, OL, 6, 32, 4, 1);
      cs(c, 1, 35, 14);
    }),
    fridge: make(16, 38, (c) => {
      P(c, 0, 0, 16, 38, '#cfd6e0'); R(c, OL, 1, 14, 14, 1); R(c, '#777e8f', 12, 5, 2, 6); R(c, '#777e8f', 12, 18, 2, 8); R(c, '#d9534f', 4, 4, 3, 3);
      sheen(c, 2, 2, 2, 0.30); sheen(c, 2, 16, 2, 0.22);
      dither(c, 'rgba(150,164,186,0.35)', 2, 25, 12, 10); cs(c, 1, 37, 14);
    }),
    dispenser: make(16, 30, (c) => {
      P(c, 3, 0, 10, 12, '#7ec8f0'); R(c, '#bfe6fa', 4, 1, 3, 8); dither(c, '#a8dcf6', 6, 8, 6, 3);
      P(c, 2, 12, 12, 18, '#dfe5ee');
      R(c, '#3b82c4', 5, 18, 2, 2); R(c, '#d9534f', 9, 18, 2, 2); R(c, '#555a6b', 4, 25, 8, 2);
      cs(c, 3, 29, 10);
    }),
    storageTable: make(48, 22, (c) => {
      P(c, 5, 0, 13, 8, '#555a6b'); R(c, '#9ad6f5', 7, 2, 7, 4); dither(c, '#c9ecff', 7, 4, 7, 2);
      P(c, 30, 0, 8, 8, '#2b2f3a'); R(c, '#d9534f', 32, 2, 2, 2);
      P(c, 0, 4, 48, 8, '#a8744a'); P(c, 1, 12, 46, 10, '#6b4429');
      grain(c, rnd, 2, 5, 44, 3, 'rgba(140,93,54,0.36)', 'rgba(255,246,222,0.09)', 24);
      sheen(c, 2, 5, 20, 0.12);
      R(c, '#8a5a34', 3, 14, 20, 6); R(c, '#8a5a34', 25, 14, 20, 6);
      dither(c, '#4a2f1c', 3, 18, 20, 3); dither(c, '#4a2f1c', 25, 18, 20, 3);
      cs(c, 2, 21, 44);
    }),
    serverRack: make(16, 38, (c) => {
      P(c, 0, 0, 16, 38, '#2b2f3a');
      R(c, '#343746', 1, 1, 14, 36);
      dither(c, 'rgba(255,246,222,0.04)', 1, 1, 14, 8);
      for (let i = 0; i < 4; i++) {
        const y = 2 + i * 9;
        B(c, 2, y, 12, 8, '#1d1722');
        R(c, '#252838', 3, y + 1, 10, 6);
        R(c, '#4aa3d8', 3, y + 2, 3, 1);
        R(c, '#4aa3d8', 3, y + 4, 5, 1);
        R(c, '#555a6b', 3, y + 6, 8, 1);
        R(c, '#555a6b', 12, y + 2, 1, 1);
        // Perforated faceplate: one texel vents, so the unit reads as hardware.
        for (let v = 4; v < 11; v += 2) R(c, 'rgba(10,6,16,0.55)', v, y + 6, 1, TEXEL);
      }
      R(c, OL, 1, 1, 14, 1);
      R(c, OL, 1, 37, 14, 1);
      sheen(c, 2, 1, 12, 0.10);
      cs(c, 1, 37, 14);
    }),
    // Precision cooling unit (CRAC) for the NOC: louvered cabinet with a cyan
    // readout, 2 tiles wide x 4 tiles tall at the 2x prop scale.
    crac: make(16, 32, (c) => {
      P(c, 0, 0, 16, 32, '#b9bfcc');
      R(c, '#cfd5e0', 1, 1, 14, 1);
      sheen(c, 2, 1, 12, 0.22);
      P(c, 1, 3, 14, 20, '#8f96a5');
      for (let i = 0; i < 9; i++) R(c, '#6f7686', 2, 4 + i * 2, 12, 1);
      // Louver lip: a lit edging under each slat gives the grille depth.
      for (let i = 0; i < 9; i++) R(c, 'rgba(255,246,222,0.10)', 2, 5 + i * 2, 12, TEXEL);
      dither(c, 'rgba(70,78,94,0.30)', 2, 18, 12, 5);
      P(c, 1, 24, 14, 6, '#3a3f4c');
      R(c, '#4aa3d8', 3, 26, 4, 2); R(c, '#5aa469', 9, 26, 2, 2);
      R(c, 'rgba(140,214,255,0.18)', 3, 25, 4, 1);
      R(c, '#6b7280', 2, 21, 12, 1);
      R(c, OL, 1, 30, 14, 1);
      cs(c, 1, 31, 14);
    }),
    // UPS battery cabinet: dark chassis, amber charge LED, blue load LED.
    ups: make(16, 16, (c) => {
      P(c, 0, 0, 16, 16, '#2b2f3a');
      R(c, '#3a3f4c', 1, 1, 14, 1);
      B(c, 2, 4, 12, 5, '#1d1722');
      R(c, '#d9a441', 3, 5, 3, 2); R(c, '#4aa3d8', 7, 5, 3, 2);
      R(c, '#555a6b', 2, 10, 12, 1); R(c, '#555a6b', 2, 12, 8, 1);
      dither(c, 'rgba(0,0,0,0.25)', 2, 12, 12, 3);
      R(c, OL, 1, 14, 14, 1);
      cs(c, 1, 15, 14);
    }),
    // Wall-mounted patch panel / access switch: 2 tiles wide, 1 tile tall.
    switchBox: make(16, 8, (c) => {
      P(c, 0, 0, 16, 8, '#343746');
      R(c, '#3f4453', 1, 1, 14, 1);
      for (let i = 0; i < 6; i++) R(c, '#4aa3d8', 2 + i * 2, 3, 1, 1);
      for (let i = 0; i < 6; i++) R(c, '#5aa469', 2 + i * 2, 5, 1, 1);
      R(c, OL, 1, 7, 14, 1);
    }),
    floorLamp: lamps.floorLamp,
    deskLamp: lamps.deskLamp,
    wallSconce: lamps.wallSconce,
    partitionH: make(16, 18, (c) => {
      // Top aluminum transom cap (depth from elevated top-down viewpoint)
      R(c, FRAME_DARK, 0, 0, 16, 1);
      R(c, FRAME_EDGE, 0, 1, 16, 1);
      R(c, 'rgba(220,236,252,0.32)', 0, 1, 16, TEXEL);
      R(c, '#2e3344', 0, 2, 16, 1);
      // Upright tinted glass pane (12 art px vertical face)
      R(c, GLASS_TINT, 0, 3, 16, 12);
      R(c, 'rgba(196,242,255,0.14)', 0, 3, 16, 3);
      R(c, 'rgba(54,104,126,0.16)', 0, 12, 16, 3);
      // Diagonal pixel glass reflections
      for (let i = 0; i < 6; i++) {
        R(c, GLASS_SHEEN, 2 + i, 4 + i, 2, 1);
        R(c, 'rgba(255,255,255,0.22)', 10 + Math.floor(i / 2), 5 + i, 1, 1);
      }
      R(c, GLASS_SPARK, 6, 6, 1, 3);
      R(c, GLASS_SPARK, 12, 7, 1, 2);
      // Vertical bay mullions
      R(c, FRAME_DARK, 0, 3, TEXEL, 12);
      R(c, FRAME_EDGE, TEXEL, 3, TEXEL, 12);
      R(c, FRAME_DARK, 15.5, 3, TEXEL, 12);
      // Floor sill track + soft ground contact shadow
      R(c, FRAME_EDGE, 0, 15, 16, 1);
      R(c, 'rgba(232,248,255,0.24)', 0, 15, 16, TEXEL);
      R(c, FRAME_DARK, 0, 16, 16, 1);
      R(c, 'rgba(10,8,20,0.24)', 0, 17, 16, 1);
    }),
    partitionV: make(10, 16, (c) => {
      // Side glass partition: top rail ridge + slanted inner glass face + floor shadow
      R(c, FRAME_DARK, 0, 0, 1, 16);
      R(c, FRAME_LIGHT, 1, 0, 2, 16);
      R(c, 'rgba(220,236,252,0.34)', 1, 0, TEXEL, 16);
      R(c, '#2e3344', 3, 0, TEXEL, 16);
      // Translucent glass panel visible beside the rail
      R(c, GLASS_TINT, 3.5, 0, 5, 16);
      R(c, 'rgba(196,242,255,0.16)', 3.5, 0, 1.5, 16);
      R(c, GLASS_SHEEN, 4.5, 2, 1, 4);
      R(c, GLASS_SHEEN, 6, 9, 1, 4);
      R(c, GLASS_SPARK, 5, 4, 1, 2);
      R(c, GLASS_SPARK, 6.5, 10, 1, 2);
      // Horizontal mullion joints at tile seams
      R(c, FRAME_DARK, 3.5, 0, 5, TEXEL);
      R(c, FRAME_EDGE, 3.5, 15.5, 5, TEXEL);
      // Floor track + soft drop shadow on the right edge
      R(c, FRAME_DARK, 8.5, 0, TEXEL, 16);
      R(c, 'rgba(10,8,20,0.20)', 9, 0, 1, 16);
    }),
    partitionHHalf: make(8, 18, (c) => {
      R(c, FRAME_DARK, 0, 0, 8, 1);
      R(c, FRAME_EDGE, 0, 1, 8, 1);
      R(c, 'rgba(220,236,252,0.32)', 0, 1, 8, TEXEL);
      R(c, '#2e3344', 0, 2, 8, 1);
      R(c, GLASS_TINT, 0, 3, 8, 12);
      R(c, 'rgba(196,242,255,0.14)', 0, 3, 8, 3);
      R(c, 'rgba(54,104,126,0.16)', 0, 12, 8, 3);
      for (let i = 0; i < 4; i++) R(c, GLASS_SHEEN, 1 + i, 5 + i, 1.5, 1);
      R(c, GLASS_SPARK, 4, 6, 1, 3);
      R(c, FRAME_DARK, 0, 3, TEXEL, 12);
      R(c, FRAME_DARK, 7.5, 3, TEXEL, 12);
      R(c, FRAME_EDGE, 0, 15, 8, 1);
      R(c, 'rgba(232,248,255,0.24)', 0, 15, 8, TEXEL);
      R(c, FRAME_DARK, 0, 16, 8, 1);
      R(c, 'rgba(10,8,20,0.24)', 0, 17, 8, 1);
    }),
    partitionCorner: make(10, 18, (c) => {
      // Corner aluminum stanchion + top cap meeting horizontal and vertical glass
      R(c, FRAME_DARK, 0, 0, 10, 1);
      R(c, FRAME_EDGE, 0, 1, 10, 1);
      R(c, 'rgba(220,236,252,0.34)', 1, 1, 8, TEXEL);
      R(c, '#2e3344', 0, 2, 10, 1);
      R(c, FRAME_DARK, 0, 0, 1, 17);
      R(c, FRAME_LIGHT, 1, 1, 2, 15);
      R(c, GLASS_TINT, 3, 3, 6, 12);
      R(c, GLASS_SHEEN, 4, 5, 2, 3);
      R(c, GLASS_SPARK, 6, 7, 1, 2);
      R(c, FRAME_EDGE, 0, 15, 10, 1);
      R(c, FRAME_DARK, 0, 16, 10, 1);
      R(c, 'rgba(10,8,20,0.24)', 0, 17, 10, 1);
    }),
    doorH: make(48, 16, (c) => {
      R(c, '#343746', 0, 4, 48, 12);
      R(c, '#d7aa5d', 1, 5, 46, 10);
      R(c, '#355d67', 2, 6, 44, 8);
      R(c, 'rgba(230,255,255,0.38)', 4, 7, 14, 4);
      R(c, '#e8c67a', 36, 8, 3, 2);
      R(c, '#a98b54', 0, 4, 48, 1);
    }),
    doorV: make(16, 48, (c) => {
      R(c, '#343746', 4, 0, 12, 48);
      R(c, '#d7aa5d', 5, 1, 10, 46);
      R(c, '#355d67', 6, 2, 8, 44);
      R(c, 'rgba(230,255,255,0.38)', 7, 5, 3, 14);
      R(c, '#e8c67a', 6, 34, 3, 2);
      R(c, '#a98b54', 4, 0, 1, 48);
    }),
  };
}

// ---------- Characters ----------
const SKINS = ['#f1c6a0', '#d9a273', '#a8744a', '#f4d2b0', '#8c5a3a'];
const HAIRS = ['#2b1d14', '#4a2f1c', '#1a1a24', '#7a4a24', '#c9a24a', '#3a2a4a'];
const PANTS = ['#2b3350', '#3a3a44', '#4a3a2a'];
export const makeLook = (
  shirt: string,
  i: number,
  accessory: LookAccessory = 'none',
  hairStyle: LookHair = 'flat',
): Look => ({
  skin: SKINS[i % SKINS.length],
  hair: HAIRS[(i * 2 + 1) % HAIRS.length],
  shirt,
  pants: PANTS[i % PANTS.length],
  accessory,
  hairStyle,
});

/** Frames per animation: a four-beat stride and a four-beat breath. */
export const CHAR_IDLE_FRAMES = 4;
export const CHAR_WALK_FRAMES = 4;
export const CHAR_SIT_FRAMES = 2;
export const CHAR_H = 24;
/** Extra height (art px) below the seat anchor so downward-facing sitters show dangling legs and shoes. */
export const CHAR_SIT_DOWN_H = 27;
/**
 * Torso lift per idle frame, in art px. The legs stay planted, so the chest and
 * head rise a pixel and settle back: a breath, not a hop.
 */
const IDLE_BOB = [0, -1, -1, 0];
/** Arm x position per walk beat when the agent faces sideways. */
const SIDE_ARM = [6, 3, 6, 9];
/** Shoulder swing per walk beat when the agent faces the camera or away. */
const FRONT_ARM = [0, 1, 0, -1];

function drawChar(c: Ctx, L: Look, dir: D3, pose: number, sit: boolean, bob = 0) {
  const y0 = sit ? 4 : 0;
  // Every torso part rides the breath; the legs below never leave the floor.
  const ty = y0 + bob;
  const leg = (x: number) => {
    R(c, OL, x, 17, 4, 7);
    R(c, L.pants, x + 1, 17, 2, 5);
    R(c, 'rgba(255,246,222,0.08)', x + 1, 18, 1, 3);
    R(c, '#2a2230', x + 1, 22, 2, 1);
    R(c, 'rgba(255,246,222,0.18)', x + 1, 22, 1, TEXEL);
  };
  if (!sit) {
    const lift = (x: number, up: boolean) => {
      if (up) {
        R(c, OL, x, 17, 4, 6);
        R(c, L.pants, x + 1, 17, 2, 4);
        R(c, '#2a2230', x + 1, 21, 2, 1);
        R(c, 'rgba(255,246,222,0.18)', x + 1, 21, 1, TEXEL);
      } else leg(x);
    };
    // Sideways: the leg pair spreads on the contact beats and closes on the
    // pass beat, which is what sells the stride from profile.
    if (dir === 'left' || dir === 'right') {
      if (pose === 1) { leg(3); leg(9); } else if (pose === 2) { leg(6); leg(7); } else if (pose === 3) { leg(2); leg(10); } else { leg(5); leg(8); }
    } else { lift(4, pose === 1); lift(9, pose === 3); }
  }
  const th = sit ? (dir === 'down' ? 7 : 8) : 9;
  B(c, 3, 9 + ty, 10, th, L.shirt);
  // Shirt bevel: lit shoulder line, subtle collar V-notch when facing camera, plus a dithered hem.
  R(c, 'rgba(255,246,222,0.18)', 4, 10 + ty, 8, 1);
  if (dir === 'down') R(c, L.skin, 7, 10 + ty, 2, 1);
  dither(c, 'rgba(16,10,26,0.20)', 4, 12 + ty, 8, th - 3);
  if (sit) {
    if (dir === 'down') {
      R(c, OL, 3, 20, 10, 2);
      R(c, L.pants, 4, 20, 8, 1);
      const sitLeg = (x: number) => {
        R(c, OL, x, 21, 4, 6);
        R(c, L.pants, x + 1, 21, 2, 4);
        R(c, 'rgba(255,246,222,0.12)', x + 1, 21, 2, 1);
        R(c, '#2a2230', x + 1, 25, 2, 1);
        R(c, 'rgba(255,246,222,0.20)', x + 1, 25, 1, TEXEL);
      };
      sitLeg(4);
      sitLeg(9);
    } else {
      R(c, OL, 3, 21, 10, 3);
      R(c, L.pants, 4, 21, 8, 2);
    }
  }
  // lengan
  if (dir === 'left' || dir === 'right') {
    // The right-facing arm is the left one mirrored around the 16 px sprite.
    const swing = SIDE_ARM[pose % SIDE_ARM.length];
    const ax = dir === 'right' ? 12 - swing : swing;
    B(c, ax, 10 + ty, 4, 7, L.shirt); R(c, 'rgba(255,246,222,0.14)', ax + 1, 11 + ty, 2, TEXEL); R(c, L.skin, ax + 1, 15 + ty, 2, 1);
  }
  else if (sit && dir === 'up') { B(c, 1, 12 + bob, 3, 6 - (pose % 2), L.shirt); B(c, 12, 12 + bob, 3, 6 - ((pose + 1) % 2), L.shirt); }
  else {
    const sw = FRONT_ARM[pose % FRONT_ARM.length];
    B(c, 1, 10 + ty + sw, 3, 7, L.shirt); B(c, 12, 10 + ty - sw, 3, 7, L.shirt);
    R(c, 'rgba(255,246,222,0.14)', 2, 11 + ty + sw, 1, TEXEL); R(c, 'rgba(255,246,222,0.14)', 13, 11 + ty - sw, 1, TEXEL);
    R(c, L.skin, 2, 16 + ty + sw, 1, 1); R(c, L.skin, 13, 16 + ty - sw, 1, 1);
  }
  // kepala
  B(c, 3, ty, 10, 9, L.skin);
  R(c, 'rgba(255,246,222,0.14)', 4, 1 + ty, 8, 1);
  dither(c, 'rgba(120,70,40,0.16)', 4, 6 + ty, 8, 3);
  const style = L.hairStyle ?? 'flat';
  const hairCol = style === 'cap' ? '#2d689c' : L.hair;
  if (dir === 'down') {
    if (style !== 'none') {
      R(c, hairCol, 4, 1 + ty, 8, style === 'cap' ? 3 : 3);
      if (style === 'spike') {
        R(c, hairCol, 5, ty, 2, 1); R(c, hairCol, 9, ty, 2, 1);
      } else if (style === 'side') {
        R(c, hairCol, 4, 4 + ty, 2, 2); R(c, hairCol, 11, 4 + ty, 1, 1);
      } else if (style === 'cap') {
        R(c, '#1d456b', 3, 3 + ty, 10, 1);
      } else {
        R(c, hairCol, 4, 4 + ty, 1, 2); R(c, hairCol, 11, 4 + ty, 1, 2);
      }
      R(c, 'rgba(255,246,222,0.16)', 5, 1 + ty, 6, TEXEL);
    }
    R(c, OL, 5, 5 + ty, 1, 2); R(c, OL, 10, 5 + ty, 1, 2); R(c, '#b0605a', 7, 7 + ty, 2, 1);
  } else if (dir === 'up') {
    if (style !== 'none') {
      R(c, hairCol, 4, 1 + ty, 8, style === 'cap' ? 6 : 7);
      if (style === 'spike') { R(c, hairCol, 5, ty, 2, 1); R(c, hairCol, 9, ty, 2, 1); }
      R(c, 'rgba(255,246,222,0.14)', 5, 1 + ty, 6, TEXEL);
      R(c, 'rgba(16,10,26,0.20)', 4, 6 + ty, 8, 2);
    }
  } else if (dir === 'right') {
    if (style !== 'none') {
      R(c, hairCol, 4, 1 + ty, 8, 3);
      R(c, hairCol, 4, 3 + ty, 4, style === 'cap' ? 3 : 5);
      if (style === 'cap') R(c, '#1d456b', 8, 3 + ty, 5, 1);
      if (style === 'spike') R(c, hairCol, 6, ty, 3, 1);
      R(c, 'rgba(255,246,222,0.16)', 5, 1 + ty, 6, TEXEL);
    }
    R(c, OL, 10, 5 + ty, 1, 2);
  } else {
    if (style !== 'none') {
      R(c, hairCol, 4, 1 + ty, 8, 3);
      R(c, hairCol, 8, 3 + ty, 4, style === 'cap' ? 3 : 5);
      if (style === 'cap') R(c, '#1d456b', 3, 3 + ty, 5, 1);
      if (style === 'spike') R(c, hairCol, 7, ty, 3, 1);
      R(c, 'rgba(255,246,222,0.16)', 5, 1 + ty, 6, TEXEL);
    }
    R(c, OL, 5, 5 + ty, 1, 2);
  }
  // Avatar accessories echoed onto world sprites (glasses / headset)
  if (L.accessory === 'glasses') {
    if (dir === 'down') {
      R(c, '#1d1722', 4, 5 + ty, 3, TEXEL);
      R(c, '#1d1722', 9, 5 + ty, 3, TEXEL);
      R(c, '#1d1722', 7, 5.5 + ty, 2, TEXEL);
      R(c, 'rgba(154,214,245,0.65)', 5, 5.5 + ty, 1, TEXEL);
      R(c, 'rgba(154,214,245,0.65)', 10, 5.5 + ty, 1, TEXEL);
    } else if (dir === 'right') {
      R(c, '#1d1722', 9, 5 + ty, 3, TEXEL);
      R(c, 'rgba(154,214,245,0.65)', 10, 5.5 + ty, 1, TEXEL);
    } else if (dir === 'left') {
      R(c, '#1d1722', 4, 5 + ty, 3, TEXEL);
      R(c, 'rgba(154,214,245,0.65)', 5, 5.5 + ty, 1, TEXEL);
    }
  } else if (L.accessory === 'headset') {
    R(c, '#343746', 3, 1 + ty, 10, TEXEL);
    R(c, '#5fd068', 3, 4 + ty, 1, 3);
    R(c, '#5fd068', 12, 4 + ty, 1, 3);
    if (dir === 'down') R(c, '#4aa3d8', 3, 7 + ty, 3, TEXEL);
  }
}
export function makeCharFrames(L: Look): CharFrames {
  const mk = (d: D3, p: number, s = false, bob = 0, h = CHAR_H) => make(16, h, (c) => drawChar(c, L, d, p, s, bob));
  const dirs: D3[] = ['up', 'down', 'left', 'right'];
  const idle = {} as CharFrames['idle'], walk = {} as CharFrames['walk'];
  for (const d of dirs) {
    idle[d] = IDLE_BOB.map((bob) => mk(d, 0, false, bob));
    walk[d] = Array.from({ length: CHAR_WALK_FRAMES }, (_, p) => mk(d, p));
  }
  const sitPoses = Array.from({ length: CHAR_SIT_FRAMES }, (_, p) => p);
  return {
    idle,
    walk,
    sit: { up: sitPoses.map((p) => mk('up', p, true)), down: sitPoses.map((p) => mk('down', p, true, 0, CHAR_SIT_DOWN_H)) },
  };
}
function makeBubble(): Texture {
  return make(14, 11, (c) => {
    B(c, 0, 0, 14, 9, '#ffffff'); R(c, OL, 3, 9, 3, 2); R(c, '#ffffff', 4, 9, 1, 1);
    R(c, OL, 3, 4, 2, 2); R(c, OL, 6, 4, 2, 2); R(c, OL, 9, 4, 2, 2);
  });
}

/** Frames of the working screen; the code rows scroll one pixel per frame. */
export const MONITOR_WORK_FRAMES = 4;

/**
 * Workstation monitor drawn separately from the desk so the screen can go dark
 * when nobody is working or ready at that computer. 16x14 art px, anchor top-center.
 * `mode` picks the screen: `off` dark, `still` lit (`ready`), `moving` scrolling
 * code (`working`), `waiting` grey with pause bars (`blocked`).
 */
function makeMonitor(mode: 'off' | 'still' | 'moving' | 'waiting', frame = 0): Texture {
  return make(16, 14, (c) => {
    P(c, 1, 0, 14, 12, '#2b2f3a');
    if (mode === 'off') {
      R(c, '#1b1f27', 2, 1, 12, 9);
      R(c, '#2a3040', 4, 2, 5, 1); R(c, '#242a36', 8, 4, 4, 1);
      dither(c, 'rgba(90,110,150,0.10)', 2, 6, 12, 4);
    } else if (mode === 'waiting') {
      R(c, '#6f7887', 2, 1, 12, 9);
      for (let y = 3; y < 10; y += 2) R(c, '#808a99', 2, y, 12, 1);
      R(c, '#3c434f', 5, 4, 2, 3); R(c, '#3c434f', 9, 4, 2, 3);
      dither(c, 'rgba(40,46,58,0.22)', 2, 7, 12, 3);
    } else if (mode === 'still') {
      R(c, '#4aa3d8', 2, 1, 12, 9);
      for (let y = 2; y < 10; y += 2) R(c, '#6fc0e8', 2, y, 12, 1);
      R(c, '#9ad6f5', 3, 2, 6, 1); R(c, '#e8f4ff', 3, 6, 4, 1);
      dither(c, 'rgba(20,60,100,0.22)', 2, 7, 12, 3);
    } else {
      R(c, '#3f93c9', 2, 1, 12, 9);
      R(c, '#6fc0e8', 2, 1, 12, 1);
      const rows = [2, 4, 6, 8];
      const widths = [9, 6, 7, 4];
      for (let i = 0; i < rows.length; i++) {
        const k = (i + frame) % rows.length;
        R(c, i % 2 ? '#1f5d8c' : '#2a6a9c', 3, rows[k], widths[(i + frame) % widths.length], 1);
      }
      R(c, '#e8f4ff', 3 + (frame % 3) * 3, 9, 2, 1);
      dither(c, 'rgba(20,60,100,0.20)', 2, 7, 12, 3);
    }
    R(c, OL, 6, 12, 4, 2);
    // Screen bloom spilling onto the bezel: the light is on, not painted on.
    if (mode !== 'off') {
      const bloom = mode === 'waiting' ? 'rgba(190,200,214,0.16)' : 'rgba(140,214,255,0.20)';
      R(c, bloom, 0, 1, 1, 9); R(c, bloom, 15, 1, 1, 9);
      R(c, bloom, 2, 0, 12, 1); R(c, bloom, 2, 10, 12, 1);
    }
  });
}

function makePlantTexture(variant: ConcretePlantStyle): Texture {
  if (variant === 'monstera') {
    return make(16, 28, (c) => {
      // Sleek matte off-white ceramic pot with dark soil rim
      P(c, 4, 18, 8, 10, '#d8d2c6'); R(c, '#efeae0', 5, 19, 6, 1.5);
      R(c, '#b7b0a2', 4, 21, 8, 1); dither(c, '#9a9385', 5, 24, 6, 4);
      R(c, '#47362b', 5, 18, 6, 1);
      // Stems
      R(c, '#25693d', 7, 11, 1.5, 8); R(c, '#25693d', 5, 13, 2, 5); R(c, '#25693d', 9, 13, 2, 5);
      // Split-leaf Monstera fronds (dark base + jade body + notched ribs)
      for (const [x, y, w, h] of [[1, 8, 6, 5], [9, 7, 6, 5], [4, 2, 8, 6], [2, 13, 4, 3], [10, 12, 4, 3]]) {
        P(c, x, y, w, h, '#2d854b');
        R(c, '#4ab36b', x + 1, y + 1, Math.max(1, w - 2), 1.5);
        R(c, '#95eba5', x + 1, y + 1, 2, 1);
      }
      // Split fenestration gaps on top and side leaves
      R(c, '#1c4f30', 7, 3, 1, 3);
      R(c, '#1c4f30', 3, 10, 1.5, 1);
      R(c, '#1c4f30', 11.5, 9, 1.5, 1);
      cs(c, 3, 26, 10);
    });
  }
  if (variant === 'palm') {
    return make(16, 28, (c) => {
      // Woven rattan basket planter
      P(c, 4, 19, 8, 9, '#b88852'); R(c, '#d4a670', 5, 20, 6, 1.5);
      dither(c, '#7a5229', 5, 21, 6, 6);
      // Slender arching palm stems
      R(c, '#2e7540', 7, 10, 2, 9);
      R(c, '#2e7540', 5, 11, 2, 8); R(c, '#2e7540', 9, 11, 2, 8);
      // Feathery palm fronds fanning outward
      for (const [x, y, w, h, col] of [
        [0, 8, 6, 2, '#3a944e'], [1, 10, 5, 2, '#4eb362'], [1, 13, 5, 2, '#2f7a42'],
        [10, 8, 6, 2, '#3a944e'], [10, 10, 5, 2, '#4eb362'], [10, 13, 5, 2, '#2f7a42'],
        [3, 4, 10, 3, '#4eb362'], [5, 1, 6, 3, '#67cc74'], [2, 6, 4, 2, '#8ef096'],
        [10, 6, 4, 2, '#8ef096'],
      ] as const) {
        P(c, x, y, w, h, col);
      }
      R(c, '#b7f7a8', 6, 2, 3, 1);
      R(c, '#b7f7a8', 2, 8, 2, 1); R(c, '#b7f7a8', 12, 8, 2, 1);
      cs(c, 3, 26, 10);
    });
  }
  if (variant === 'bonsai') {
    return make(16, 28, (c) => {
      // Low glazed slate-blue bonsai dish + pebble soil
      P(c, 2, 22, 12, 5, '#3b5875'); R(c, '#638ab0', 3, 22, 10, 1);
      dither(c, '#23364a', 3, 25, 10, 2);
      R(c, '#574334', 4, 21, 8, 1.5);
      // Gnarled curving bonsai trunk & branches
      R(c, '#4f3322', 6, 16, 3, 6); R(c, '#4f3322', 7, 11, 3, 6);
      R(c, '#4f3322', 4, 12, 4, 2); R(c, '#4f3322', 9, 9, 3, 3);
      R(c, '#704a32', 7, 13, 1, 7);
      // Tiered cloud foliage pads + subtle blossom accents
      for (const [x, y, w, h] of [[1, 9, 6, 4], [9, 7, 6, 4], [4, 3, 8, 5]]) {
        P(c, x, y, w, h, '#2c7d48');
        R(c, '#48a866', x + 1, y + 1, w - 2, 1.5);
        R(c, '#92eba0', x + 1, y + 1, 2, 1);
      }
      R(c, '#f5a8c4', 2, 10, 1.5, 1); R(c, '#f5a8c4', 11, 8, 1.5, 1); R(c, '#f5a8c4', 7, 4, 2, 1);
      cs(c, 2, 26, 12);
    });
  }
  if (variant === 'cactus') {
    return make(16, 28, (c) => {
      // Southwestern painted terracotta pot
      P(c, 4, 19, 8, 9, '#c2653d'); R(c, '#e08458', 5, 20, 6, 1.5);
      R(c, '#ebe0cc', 5, 23, 6, 2); R(c, '#4a6b82', 6, 23.5, 1.5, 1); R(c, '#4a6b82', 9, 23.5, 1.5, 1);
      dither(c, '#8c4427', 5, 25, 6, 3);
      // Ribbed saguaro column + twin arms
      P(c, 6, 4, 4, 15, '#338a68'); R(c, '#56b58c', 7, 5, 1.5, 13);
      P(c, 2, 9, 4, 4, '#338a68'); P(c, 2, 7, 2.5, 5, '#338a68'); R(c, '#8ee8be', 2.5, 8, 1, 3);
      P(c, 10, 11, 4, 4, '#338a68'); P(c, 11.5, 8, 2.5, 6, '#338a68'); R(c, '#8ee8be', 12, 9, 1, 3);
      // Spine pips + golden flower crown
      R(c, '#dff7e8', 6.5, 7, TEXEL, 1); R(c, '#dff7e8', 9, 10, TEXEL, 1); R(c, '#dff7e8', 7, 14, TEXEL, 1);
      P(c, 6.5, 1.5, 3, 2.5, '#f2c037'); R(c, '#fff099', 7, 2, 1.5, 1);
      cs(c, 3, 26, 10);
    });
  }
  // Classic terracotta bush
  return make(16, 28, (c) => {
    P(c, 4, 18, 8, 10, '#b5653d'); R(c, '#d98355', 5, 19, 6, 2); dither(c, '#8f4a2c', 5, 24, 6, 4);
    R(c, '#2f7a45', 7, 10, 2, 9);
    for (const [x, y, w, h] of [[1, 8, 6, 4], [9, 8, 6, 4], [4, 2, 8, 6], [2, 13, 5, 3], [9, 13, 5, 3]]) {
      P(c, x, y, w, h, '#3f9a55'); R(c, '#8fe79f', x + 1, y + 1, 2, 1);
    }
    cs(c, 3, 26, 10);
  });
}

function makePlantVariants(): Record<ConcretePlantStyle, Texture> {
  return {
    classic: makePlantTexture('classic'),
    monstera: makePlantTexture('monstera'),
    palm: makePlantTexture('palm'),
    bonsai: makePlantTexture('bonsai'),
    cactus: makePlantTexture('cactus'),
  };
}

export function generateAssets(night: boolean, looks: Look[], floor: FloorStyle = 'oak'): Assets {
  const plantVariants = makePlantVariants();
  const lampOff: Record<LampType, Texture> = {
    floorLamp: makeLampTexture('floorLamp', false),
    deskLamp: makeLampTexture('deskLamp', false),
    wallSconce: makeLampTexture('wallSconce', false),
  };
  const lampOn: Record<LampType, Texture> = {
    floorLamp: makeLampTexture('floorLamp', true),
    deskLamp: makeLampTexture('deskLamp', true),
    wallSconce: makeLampTexture('wallSconce', true),
  };
  const furn = makeFurniture(plantVariants.classic, night ? lampOn : lampOff);
  return {
    background: makeBackground(night, floor),
    furn,
    plantVariants,
    lampOn,
    lampOff,
    bubble: makeBubble(),
    monitorOn: makeMonitor('still'),
    monitorWorking: Array.from({ length: MONITOR_WORK_FRAMES }, (_, f) => makeMonitor('moving', f)),
    monitorWaiting: makeMonitor('waiting'),
    monitorOff: makeMonitor('off'),
    chars: looks.map(makeCharFrames),
  };
}

export interface RackLed {
  x: number;
  y: number;
  /** Random start angle, so no two LEDs on the panel blink in step. */
  phase: number;
  /** Small random multiplier on the shared blink rate: organic panel, not a chorus. */
  rate: number;
}
/**
 * Blink speed for the NOC rack LEDs. One notch per `working` agent; the idle
 * office keeps a slow heartbeat and the busiest office is capped so the panel
 * still reads as status, not as a warning light.
 */
export function rackBlinkRate(workingAgents: number): number {
  const n = Number.isFinite(workingAgents) ? Math.max(0, Math.floor(workingAgents)) : 0;
  return Math.min(RACK_BLINK_MAX, RACK_BLINK_BASE + RACK_BLINK_STEP * n);
}
/**
 * LED dots on the NOC racks. `scale` is the prop pixel scale and `widthTiles`
 * the rack footprint, so the dots stay centred on the rack face when a prop
 * scale widens or enlarges the rack sprites.
 */
export function makeRackLeds(scale = ART, widthTiles = 1): RackLed[] {
  const leds: RackLed[] = [];
  for (const ty of RACK_ROWS) {
    for (const tx of RACK_COLS) {
      const x = (tx + widthTiles / 2) * TILE;
      const spriteTop = (ty + 1) * TILE - 38 * scale;
      for (let j = 0; j < 4; j++) {
        const y = spriteTop + (2 + j * 9) * scale;
        leds.push({
          x,
          y,
          phase: Math.random() * Math.PI * 2,
          rate: 0.9 + Math.random() * 0.2,
        });
      }
    }
  }
  return leds;
}
