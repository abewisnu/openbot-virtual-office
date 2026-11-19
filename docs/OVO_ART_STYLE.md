# OVO — Art Style & Rendering

## Art Style

The office is **32-bit high-resolution pixel art**. That is a statement about drawing detail and
technique, not about file depth — every tone is a literal `#rrggbb` written into an RGBA canvas, so
nothing is indexed and no per-sprite palette cap is enforced. Detail comes from 2× texture density,
multi-step shading ramps, dithered gradients, contact shadows (AO) and an atmospheric runtime layer,
not from moving the drawing grid off the 16 px tile.

| Measure | Value |
|---|---|
| Base tile | 16×16 art px (`TILE = 32` screen px at `ART = 2`) |
| Floor plate | 960×640 art px = 60×40 tiles (`COLS × ROWS`) |
| Character frame | 16×24 art px; 4 native facings (up/down/left/right); idle 4 frames, walk 4, sit 2 |
| Largest props | whiteboard 64×52, meeting table 64×36, rack 16×38, desk 32×28 art px |
| Colours per sprite | 2–10 opaque tones (whiteboard and bookshelf 10, desk 8, monitor 7, cabinet 3) |
| Master palette | 123 hex values in the generator, 337 distinct tones once the sky gradient counts |
| Texture density | `DENSITY = 2` texels per art px — outlines, bevels and dither dots land on the 1 screen px grid |
| Upscale | props at 4 screen px per art px (`PROP_SCALE 2`), floor stays at 2 (`ART`); the draw scale divides `DENSITY` back out, so on-screen size is unchanged |

Why 32-bit rather than 16-bit: the detail budget moved from the drawing grid to the texture grid.
Each material carries a multi-step shading ramp with a highlight, base and shadow band plus a dithered
pass between them, and every prop drops a soft contact shadow instead of a single dark blob. The
animation budget follows the same logic — an idle breathing loop of four frames, a four-frame walk
cycle and a two-frame typing sit, authored natively for all four facings so nothing is mirrored.

The drawing grid stays 16-bit, but the textures are authored at **2× density**: `make()` allocates a
`DENSITY`-times canvas and scales the 2D context by the same factor, so every generator keeps using
art-pixel coordinates while the texture holds two texels per art pixel. Sprites draw at
`ART / DENSITY` (props `PROP / DENSITY`), which cancels the extra texels and leaves the on-screen
size identical. What changes is detail: one texel is half an art pixel, so outlines, bevels and
dither dots sit on the 1 screen px grid instead of the old 2 px block grid.

Edges stay hard because the art is drawn once into textures with
`TextureStyle.defaultOptions.scaleMode = 'nearest'`, `antialias: false` and `roundPixels: true`, then
scaled by whole numbers only. Anything drawn at `ART` (floor, glass, doors) never leaves the tile
grid; only props follow `?props=`.

## Depth Pass (Props, Light, Particles, Hover)

Four layers sit on top of the base sprite art and none of them changes a sprite size, a collision
box or a hit target.

### Prop Detail

`AssetGenerator.ts` has two surface helpers: `grain()` scatters a fixed dark/light dither over a
rect, `sheen()` lays a low-alpha highlight band across it. They are baked into the desk tops, the
coffee, dining and meeting tables, the storage table, both sofas, the fridge fronts (two sheens) and
the perforated `TEXEL` faceplates of the server racks and the CRAC louvres. The art is still drawn
once at load; nothing here runs per frame.

### Day Cycle

`DayCycle.ts` is a pure curve over the local hour: seven keyframes (0 and 4.5 night, 6 dawn,
8 and 16 day, 17.5 dusk, 19.5 night). `mixColor()` blends `tint` per channel and the mix
returns `{ key, night, tint, tintAlpha, rayScale }`. `World` re-runs `refreshDaylight()` once a
clock second comes due and rebuilds the window skyline only when `night` actually flips, so the
dusk transition costs one texture swap, not one per frame.

### Atmosphere

`Atmosphere.ts` draws god rays and floor light pools in world space and the vignette plus ambient
colour wash in screen space. Ray strength follows `rayScale` with a slow
breathe (`0.72 + 0.28 × sin(t × 0.55)`) and gains up to `0.35` as `working` agents approach six.
The vignette is captured from a 96×60 canvas and upscaled with `nearest`, so the gradient bands
into chunky pixel steps instead of a smooth modern falloff.

### Particles

`Particles.ts` keeps 56 dust motes drifting inside the three window shafts and
opens timed emitters over `dispenser` and `coffeeTable` (steam) and `crac` (cool air) after
`World.buildEmitters()` scans `layout.furniture`. Motes are drawn into a single `Graphics` per
frame and capped at `MAX_MOTES = 150`; the layer mounts between `sortLayer` and `roomLabelLayer`
so a mote passes over a desk but never over a room plate.

### Hover and Selection

`Character` carries two non-click graphics: `ring` (selection, `0xfff3a0`,
2 px, alpha pulsing `0.72 + 0.28 × sin(anim × 4)`) and `hoverRing` (pointer feedback, 1 px, alpha
`0.45`, hidden while the ring is shown). On top of that, `World.hoverMark` draws a rounded bay
around the hovered workstation — two strokes, `2 / zoom` at alpha 0.55 and `1 / zoom` at 0.9, so
the line keeps a constant screen weight at every zoom step. `pointermove` sets the cursor to
`pointer` over an employee and `default` elsewhere, `pointerup` selects only when the drag moved
less than 5 px (so a camera pan never opens a panel), and `Escape` clears the selection.

## Motion and Performance

### Reduced Motion

`World.bindMotion()` reads `(prefers-reduced-motion: reduce)` once at init and
re-applies on `change`. `Character.setCalm()` pins the idle and typing frames to frame 0, holds the
selection ring at full alpha and drops the speech-bubble bob; `Atmosphere.setCalm()` stops the
breathe clock so ray and pool strength stay fixed; `Particles.setQuality(0)` hides the mote layer
outright. The walk cycle keeps running on purpose — that motion is the simulation, not decoration.
`index.css` turns off the HUD progress-bar transition under the same query.

### Hidden Tab

A `visibilitychange` listener stops `app.ticker` when `document.hidden` is true, so a
background tab does no WebGL work at all, and restarts it on return after zeroing `frameAvg` and
`budgetT`. The wake-up delta is never fed into the budget.

### Adaptive Particle Budget

`World.tuneParticles()` keeps an exponential moving average of frame
time (weight `0.05`) and, once every 1.5 s, steps `particleQuality` down by `1/3` when the average
exceeds 26 ms or up by `1/3` when it drops under 18.5 ms. The scale floors at `1/3` and caps at `1`,
and `Particles` applies it to the mote cap, the dust target and the emitter cadence. Deltas above
250 ms are ignored so a single stall cannot trigger a false downgrade.
