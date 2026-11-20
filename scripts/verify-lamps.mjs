// Verifies the workstation lamp rule under Moody night lighting: a desk lamp
// may only glow while its own agent is physically seated there and the phase is
// `ready` or `working`. Empty desks, walkers, `blocked` agents waiting for a
// human, and every other phase keep the bulb dark, and a dark bulb must not
// leave an emissive pool behind. Ambient fixtures (floor lamps, wall sconces)
// are intentionally not part of this rule.
// Run with: node scripts/verify-lamps.mjs
import { readFileSync } from 'node:fs';
import { deskLampLitFor } from '../src/office/Lamp.ts';

const cases = [
  // [phase, seated, expected]
  ['working', true, true],
  ['ready', true, true],
  ['blocked', true, false],
  ['idle', true, false],
  ['starting', true, false],
  ['restarting', true, false],
  ['stopped', true, false],
  [undefined, true, false],
  // The bug this gate exists for: phase says working/ready, but the body is still
  // walking to the desk (or left for the lounge), so the desk must stay dark.
  ['working', false, false],
  ['ready', false, false],
  ['blocked', false, false],
  ['idle', false, false],
  [undefined, false, false],
];

let failed = 0;
for (const [phase, seated, want] of cases) {
  const got = deskLampLitFor(phase, seated);
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} phase=${String(phase).padEnd(10)} seated=${String(seated).padEnd(5)} want=${String(want).padEnd(5)} got=${got}`,
  );
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const layout = read('../src/office/Layout.ts');
const world = read('../src/office/World.ts');
const art = read('../docs/OVO_ART_STYLE.md');
const officeLayout = read('../docs/OVO_OFFICE_LAYOUT.md');

// Source guards: the rule must survive a future edit of any file in the chain.
const guards = [
  ['Layout.ts furniture carries an optional seatId', /seatId\?: string;/.test(layout)],
  [
    'Layout.ts puts a deskLamp on every workstation desk',
    /type: "deskLamp"[\s\S]{0,200}?seatId,/.test(layout) && !/n % 2 === 0/.test(layout),
  ],
  ['Layout.ts binds the lamp to the seat id it just minted', /const seatId = `WS-/.test(layout)],
  ['World.ts imports the lamp gate', /import \{ deskLampLitFor \} from '\.\/Lamp'/.test(world)],
  [
    'World.ts resolves lit desks from a seated body on the same seat',
    /litDeskSeatIds\(\)[\s\S]{0,600}state === 'sit'[\s\S]{0,200}ch\.seat === seat[\s\S]{0,300}deskLampLitFor\(/.test(world),
  ],
  ['World.ts swaps desk textures from the lit set', /updateLamps\(\)[\s\S]{0,500}litDeskSeatIds\(\)/.test(world)],
  [
    'World.ts refreshes lamps every frame, not only on a daylight tick',
    /this\.updateRackLeds\(\);\s*this\.updateLamps\(\);\s*this\.updateMonitors\(\);/.test(world),
  ],
  [
    'World.ts pools a desk lamp only while its desk is lit',
    /for \(const \{ seatId, light \} of this\.deskLampLights\) \{\s*if \(!seatId \|\| !deskLit\.has\(seatId\)\) continue;/.test(world),
  ],
  ['World.ts keeps ambient fixtures in their own list', /staticLampLights\.push\(\{ x: f\.x, y: f\.y - 36/.test(world)],
  [
    'World.ts never emits a pool on dawn with the bulb off',
    !/daylight\.key === 'dawn'[\s\S]{0,40}0\.40/.test(world),
  ],
  ['OVO_ART_STYLE.md documents the per-agent desk lamp gate', /deskLamp` is gated per agent/.test(art)],
  ['OVO_OFFICE_LAYOUT.md documents the seatId binding', /seatId/.test(officeLayout)],
];
for (const [label, ok] of guards) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed) {
  console.error(`\n${failed} lamp check(s) failed.`);
  process.exit(1);
}
console.log('\nAll lamp checks passed: desk lamps light only for a seated ready/working agent.');
