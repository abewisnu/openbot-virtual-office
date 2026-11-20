# OVO — Office Layout & Rooms

The office world is one shared floor plate with five zones. `zoneName()` in
`src/office/Layout.ts` returns the name the HUD shows for the tile under the pointer.

## Rooms

| Room | Walls | Interior | Door |
|---|---|---|---|
| Meeting | column 17 and column 32 (rows 5–19), row 20 | columns 18–31, rows 6–19 | 3-tile opening in column 32, rows 10–12, facing the 3-tile aisle (33–35) before the first desk bay |
| Workstations | none — open plan, meeting-room glass on its left | columns 36–58, rows 6–31; bays on columns 37/43/49/55 and rows 9/15/21/27 | open bay fronts (no partition) |
| Lounge | none — open plan, north window band is its only hard edge | columns 1–13, rows 6–15 (`LOUNGE_ROOM`) | open to the columns 15–16 aisle |
| Pantry & Storage | none — open plan; shelf wall along row 20 in three clusters with one-tile gullies | columns 1–13, rows 16–29 | open at the shelf gullies |
| NOC | pantry wall on row 30, two openings | columns 1–13, rows 31–38; racks, CRAC, UPS and patch panels | openings at columns 6–7 and column 10 |

## Meeting Room

The Meeting Room sits one room-width left of the workstation block, enclosed by 2.5D top-down
glass partitions (`partitionV`, `partitionH`, `partitionHHalf`, `partitionCorner`) with metallic
mullions and specular glass highlights. Its interior is laid out in pixels so each prop keeps a
margin from the glass at 2×: a 3-seat sofa and the 64×52 whiteboard along the top band, an 8-seat
table under them, a 10×8 rug beneath the whole bay, a plant in each bottom corner, and two
`floorLamp` fixtures at cols 18 and 31 on row 7. The floor runs two rows past the rug (rows 18–19)
so the carpet stops clear of the bottom glass on row 20, with both side partitions (columns 17 and
32) joined cleanly via corner mullions. The whiteboard sits at the right end of the top band
(x 872–1000, 4 tiles), 88 px clear of the sofa and hung 12 px above its base line, so the pair
read as one wall band without covering each other.

## Lounge

A 6-tile three-seat sofa one row off the window band (cols 4–9, row 8), a 4×2 coffee table
centred under it (cols 5–8, rows 10–11, with coffee-cup steam emitted directly over the cup), and a
4-tile loveseat on each side facing up (cols 1–4 and 10–13, row 13), so the three pieces ring the
table without overlapping sprites. A 10×6 rug sits under the bay, a tall plant flanks each side of
the sofa on row 8, a `floorLamp` sits in the lower-left corner at `(1, 15)`, and rows 9 and 14 stay
open wall to wall so every seat is reachable from the open-plan aisle.
Seven lounge seats (`LS-1/3/5`, `LL-1/3`, `LR-1/3`).

## Pantry & Storage

Three shelf clusters on row 20 (two tiles below the top wall) with a one-tile gutter at col 5 and
col 10 (bookshelf 4 tiles, cabinet, fridge and dispenser 2 tiles each), a 4-tile `diningTable`
with two chairs per long side centred on a 6×6.5 rug (`x: 4, y: 21.5`, chairs centred at x 192 and
256, one 2-tile sprite apart so nothing overlaps, approach rows 22 and 27), a `floorLamp` at `(1, 26)`,
and balanced corner plants at `(1, 28)` and `(12, 28)`. Circulation lanes remain clear of decorative
plants. Footprint widths follow the art at the 2× prop scale, and `place()`/`block()` reject
fractional tiles.

## Lighting Fixtures

Interior light fixtures double as architectural props (unlit during Day) and warm pools of light
when **Moody night lighting** is active at Dusk/Night:
- **`floorLamp`**: Lounge `(1, 15)`, Meeting Room `(18, 7)` and `(31, 7)`, Pantry `(1, 26)`, and
  the Workstation entrance corner `(33, 7)`.
- **`wallSconce`**: North corridor wall pillar (`x: 1280, y: 124`) and NOC partition transom
  (`x: 128` and `x: 352` at `y: 970`).
- **`deskLamp`**: One per workstation desk, mounted on the desk corner without adding floor collision.
  Every seat carries its lamp's `seatId` (`WS-nn`), so the light follows the agent rather than the
  room: while **Moody night lighting** is active at Dusk/Night, a desk lamp is lit only when a
  `ready` or `working` agent is physically seated at that desk. Empty, unstaffed, `idle`, `blocked`,
  `starting`, `restarting` and `stopped` desks stay dark, because a reserved seat is not an occupant.
  Floor lamps and wall sconces are ambient fixtures and stay lit with the option enabled.

## NOC — Network Operations Centre

The lower-left room (cols 0–13, rows 31–38): the one room in the office that is **infrastructure,
not workspace**. No agent ever works there — it has no seat, no desk and no chat spot in
`Layout.ts` — because its job is to show what keeps the roster on screen: the read-only
`GET /api/agents` feed, not people. The room is dressed as a live facility, left to right: two
`serverRack` cabinets at cols 2 and 4 on row 36, four server units each, the machines behind the
agent list; a louvered CRAC at col 8 on the same row, its cooling for the heat those units put
out; a UPS cabinet at col 11, the power that keeps the feed up during a cut; and two
wall-mounted `switchBox` patch panels (access switches) on row 31 at cols 7 and 10, the network
path the API is served over. Every tall prop is based on row 36 so it grows upward to row 32 and
never clips the pantry wall at row 30, and the two walk lanes (cols 6–7 and col 10) stay open.

The floor is a raised-floor plenum, not carpet: access panels drawn into the floor texture, every
other one perforated for cold-aisle airflow, inside a clip rectangle measured on the partition
faces rather than whole tiles (x 0–228 art px — the col-14 pane is 8 art px wide and centred, so
its room-side face is 4 art px inside the tile line — and y 484–640 art px, row-30 pane bottom
face to the last floor row), so no bare strip shows on either edge and no carpet spills past the
glass.

## Rack LEDs as a Workload Gauge

The eight LEDs (4 per rack, `2 × PROP_SCALE` square core with a `4 × PROP_SCALE` pixel cross halo
and bright specular corner pixel, green `0x5fd068` / red `0xd9534f`) are not decoration — they read
the roster. Each LED opens at `Math.random() * 2π` with a `0.9–1.1` rate jitter (`makeRackLeds`),
so the panel never blinks in chorus. The shared blink clock runs one notch per `working` agent,
`RACK_BLINK_BASE 1.5` + `RACK_BLINK_STEP 0.4` rad/s, capped at `RACK_BLINK_MAX 4.6` the moment
eight agents work (about a 1.4 s full green/red cycle), and `World` eases the rate toward that
target (`dt * 1.2`) instead of the phase, so a phase change makes the panel speed up smoothly and
never jump. An idle office sits near 2.1 s per half-blink; ten working agents near 0.7 s.
Measured in the browser at 20 fps: 0.45–0.52 toggles/s per LED with one agent working,
1.04–1.30 with ten. `scripts/verify-rack-leds.mjs` pins the rate table.

## Sofa Sitters

A seat on the down-facing 3-seat sofas (Lounge and Meeting Area) carries `zOffset = 8`, so the
body sorts **in front of** the sofa sprite. Without it the backrest overdraws the torso and only
the head shows above it, which reads as the agent sitting the wrong way round. The up-facing
loveseats keep `zOffset = 0` because their backrest sits between the viewer and the sitter.

## Agent Name Plates

12 px bold on a 19 px pill with an r4 status dot, so the label stays readable at the shipped 2×
prop scale. A `ready`/`working` agent sitting at a workstation carries the plate **under its
chair** (`BELOW_CHAIR = -10` art px: plate centre 20 screen px below the feet at 2×, about 8 px
clear of the chair's bottom edge) instead of over the head, where it covered the monitor and the
seated sprite; the speech bubble cancels the drop so it still leaves the head clear. Any other
pose keeps the plate above the agent — social seats at 52 art px, standing and walking at 64
art px — so the plate lifts back up as soon as the agent stands, and a blocked/idle sitter is
unchanged.

## Room Plates

`ROOM_LABELS` in `Layout.ts`: each is 14 px tall and centred on its tile, so
`ensureRoomLabelsClear()` only checks that one row — a plate may sit on the bottom row of a rug
even when the table or a plant occupies the row above. Positions: WORKSTATIONS on row 6
(directly under the window band, centred on the third window), PANTRY & STORAGE on row 27
(bottom rug row), MEETING ROOM on row 17 (bottom rug row), NOC on (7,33) in the open lane
between the rack sprites (end x 192) and the CRAC (starts x 256). `roomLabelLayer` is added
**after** `sortLayer`, so no plate can be hidden behind a tall prop.

## Monitor Rules

A desk monitor lights up only if the agent is **already seated** on that chair (state `sit` on the
same `seat`) and its `phase` is `working`, `ready` or `blocked`. The chair is reserved from the
moment the agent starts walking, so an agent still walking to its desk = screen stays dark.
`working` = screen **moving** (4 frames, code rows scroll one pixel per frame, caret moves, swap
every 220 ms); `ready` = screen **still**; `blocked` = screen **grey with pause bars**, because the
agent is parked in front of the computer until a human answers its prompt/approval or the usage
limit resets — it stays there and starts typing again the moment the phase moves on.
`idle`/`restarting`/`stopped` = dark screen
(`World.ts` → `updateMonitors`, `AssetGenerator.ts` → `makeMonitor(mode, frame?)`).

## Simulated Positions

Idle (`idle`/`stopped`) agents move on their own every 20–45 s: they pick a chair in the Meeting
Room, Lounge or Pantry; a `waiting` or `unread` agent walks to its own desk instead. A seated idle
agent keeps its chair for 18–40 s (`Math.random() < 0.6` = stay put) and shows a talk bubble when
somebody sits facing it, so two standby agents read as a conversation. Goals come from
`src/office/Idle.ts` (`pickIdleSeat()` / `pickIdleTile()` / `isChattingSeat()` / `visAVis()`) —
the office stays alive when the database cannot be read. Last known idle, break, and lounge poses
are persisted in `localStorage` under `ovo-agent-poses`, so refreshing the page restores each
idle/lounge agent to its exact spot and facing direction.
