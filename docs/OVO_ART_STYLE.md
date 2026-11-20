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

### Prop Detail & Material Variants

`AssetGenerator.ts` has two surface helpers: `grain()` scatters a fixed dark/light dither over a
rect, `sheen()` lays a low-alpha highlight band across it. They are baked into the desk tops, the
coffee, dining and meeting tables, the storage table, both sofas, the fridge fronts (two sheens) and
the perforated `TEXEL` faceplates of the server racks and the CRAC louvres. Glass partitions use
2.5D top-down mullions with top-cap shading (`partitionH`, `partitionHHalf`, `partitionV`,
`partitionCorner`). The art is drawn once at load; nothing here runs per frame.

Settings allows live switching between **5 floor styles** (`Warm Oak`, `Dark Walnut`, `Herringbone`,
`Slate Check`, `Light Grid` — persisted under `ovo-floor`) and **6 plant styles** (`Classic Bush`,
`Monstera`, `Areca Palm`, `Zen Bonsai`, `Desert Cactus`, `Assorted Mix` — persisted under `ovo-plant`).
Three interior lamp sprites (`floorLamp`, `deskLamp`, `wallSconce`) ship with dual unlit (`lampOff`)
and warm-amber lit (`lampOn`) textures.

### Day Cycle

`DayCycle.ts` is a pure curve over the local hour (or an explicit `Settings → Atmosphere` override:
`Auto (Clock)`, `Dawn`, `Day`, `Dusk`, `Night`): seven keyframes (`0` and `4.5` night, `6` dawn,
`8` and `16` day, `17.5` dusk, `19.5` night). `mixColor()` blends `tint` per channel and returns
`{ key, night, tint, tintAlpha, rayScale, ambientDark }`. `World` re-runs `refreshDaylight()` once
per second (or immediately on Settings change) and swaps the cached background texture when `night`
or `floorStyle` changes.

### Atmosphere & Moody Night Lighting

`Atmosphere.ts` operates on a pixel-aligned grid (`ATMO_STEP = 2`, `960×640` texels upscaled with
`nearest` filtering) and renders **no screen-edge black vignette**:

- **Window God Rays & Floor Pools**: Stepped luminance bands with `4×4` ordered Bayer dithering
  beneath the three north windows, tinted warm gold during Day/Dawn, sunset amber at Dusk, and cool
  moonlight at Night. Ray strength follows `rayScale` with a calm breathe (`0.72 + 0.28 × sin(t × 0.55)`)
  and gains up to `0.35` as `working` agents approach six.
- **Emissive Local Pools**: Bayer-dithered glow pools under active monitors, NOC hardware (`serverRack`,
  `crac`, `ups`), pantry appliances (`fridge`, `dispenser`), and the interior lamps. Ambient fixtures
  (`floorLamp`, `wallSconce`) follow the moody day gate (`night` 1, `dusk` 0.68, off at dawn/day), while
  every workstation `deskLamp` is gated per agent: it only glows when its seat's owner is physically
  seated and in phase `ready` or `working`. A reserved desk, a walker, a `blocked` agent waiting for a
  human, and every idle/starting/restarting/stopped desk produce no pool and no cutout.
- **Moody / Low-Key Night Lighting (Dark Ambient + Pools of Light)**: Enabled by default via
  **Settings → Moody night lighting** (`ovo-moody-lighting`). At Night (`ambientDark = 0.56`) and
  Dusk (`0.28`), a deep `#070918` pixel-grid ambient veil sits between sorted world sprites and room/name
  labels while active lamps, glowing monitors, NOC racks, and the three north windows carve warm and
  cool Bayer-dithered **Pools of Light** using `destination-out` radial cutouts. Turning the option
  off disables the dark ambient veil and lamp glow for a uniformly lit night scene.
- **Screen Colour Wash**: A flat full-viewport tint (`tint`, `tintAlpha`) without darkening edges.

### Particles

`Particles.ts` keeps 56 dust motes drifting inside the three window shafts and
opens timed emitters over `dispenser` (hot/cold steam), `coffeeTable` (steam aligned over the cup)
and `crac` (cool air) after `World.buildEmitters()` scans `layout.furniture`. Motes are drawn into
a single `Graphics` per frame and capped at `MAX_MOTES = 150`; the layer mounts between `sortLayer`
and `roomLabelLayer` so a mote passes over a desk but never over a room plate.

### Hover, Selection & Room Navigation

`Character` carries crisp pixel graphics: `ring` (selection, `0xfff3a0`, 2 px, pulsing
`0.72 + 0.28 × sin(anim × 4)`) and `hoverRing` (pointer feedback, 1 px, alpha `0.45`). `World.hoverMark`
draws a pixel-crisp corner-pipped workstation outline around hovered desks, while hovering an agent
or desk surfaces a compact HUD tooltip (`hoveredAgent`). Clicking a room button in the top-right
camera bar (`Lounge`, `Meeting`, `Pantry`, `NOC`, `Desks`) glides the camera there at `125%` zoom and
renders a 3-second slow-flashing pixel highlight box (`roomHighlight`) around that room. `pointerup`
selects only when the drag moved less than 5 px, and `Escape` clears the selection.

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
