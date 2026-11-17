// Verifies the Lounge confinement rule: a `starting` or `restarting` agent waits
// inside the Lounge room and is never given a goal outside it. The room bounds
// are pure constants, so they are checked directly; World.ts is then
// source-guarded so a future edit cannot quietly send a penned agent to a desk
// again.
// Run with: node scripts/verify-lounge.mjs
import { readFileSync } from 'node:fs';
import { LOUNGE_ROOM, isInLounge, staysInLounge } from '../src/office/Lounge.ts';

const cases = [
  // [tx, ty, expected] — first lounge floor tile, lounge corners, then the
  // tiles just outside: doorway, meeting room, NOC, pantry, north wall.
  [1, 6, true],
  [13, 15, true],
  [1, 15, true],
  [13, 6, true],
  [7, 10, true],
  [14, 13, false], // doorway out of the room
  [14, 10, false], // partition column
  [7, 16, false], // partition row
  [0, 10, false], // west wall
  [7, 5, false], // north wall
  [24, 12, false], // meeting room
  [7, 22, false], // NOC
  [6, 37, false], // pantry / storage
];

let failed = 0;
for (const [tx, ty, want] of cases) {
  const got = isInLounge(tx, ty);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} tx=${tx} ty=${ty} want=${want} got=${got}`);
}

const phaseCases = [
  ['starting', true],
  ['restarting', true],
  ['idle', false],
  ['ready', false],
  ['working', false],
  ['blocked', false],
  ['stopped', false],
  [undefined, false],
];
for (const [phase, want] of phaseCases) {
  const got = staysInLounge(phase);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} phase=${String(phase).padEnd(10)} want=${want} got=${got}`);
}

// The bounds duplicate MIN_WALK_ROW in constants.ts on purpose (a pure module
// cannot import it); fail loudly if the wall row ever moves.
const constants = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const wallRow = /MIN_WALK_ROW = (\d+)/.exec(constants);
const boundsMatchWall = wallRow ? Number(wallRow[1]) === LOUNGE_ROOM.minTy : false;
if (!boundsMatchWall) failed++;
console.log(`verdict=${boundsMatchWall ? 'PASS' : 'FAIL'} LOUNGE_ROOM.minTy=${LOUNGE_ROOM.minTy} constants.MIN_WALK_ROW=${wallRow?.[1]}`);

const lounge = readFileSync(new URL('../src/office/Lounge.ts', import.meta.url), 'utf8');
const phaseList = /return phase === 'starting' \|\| phase === 'restarting';/.test(lounge);
if (!phaseList) failed++;
console.log(`verdict=${phaseList ? 'PASS' : 'FAIL'} Lounge.ts pens both starting and restarting`);

const world = readFileSync(new URL('../src/office/World.ts', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/office/Layout.ts', import.meta.url), 'utf8');
const guards = [
  ['World.ts pens lounge tiles through isInLounge()', /loungeTiles = this\.walkable\.filter\(\(t\) => isInLounge\(t\.tx, t\.ty\)\)/.test(world)],
  ['World.ts pens lounge seats through isInLounge()', /loungeSeats = this\.layout\.seats\.filter\([\s\S]{0,160}isInLounge\(s\.approach\.tx, s\.approach\.ty\)/.test(world)],
  ['World.ts branches on staysInLounge() for the phase', /staysInLounge\(/.test(world)],
  ['assign() returns into assignLounge() for a penned agent', /if \(penned\) \{\s*\n\s*this\.assignLounge\(ch, instant\);\s*\n\s*return;/.test(world)],
  ['an idle penned agent wanders with wanderLounge()', /if \(penned\) this\.wanderLounge\(ch\); else this\.wander\(ch\);/.test(world)],
  ['assignLounge() picks goals only from loungeSeats/loungeTiles', /assignLounge\([\s\S]{0,700}this\.loungeTiles\[/.test(world)],
  ['a penned agent owes no desk visit', /staysInLounge\(emp\?\.phase\) \? false : this\.owesDesk\(emp\)/.test(world)],
  ['the live caption names the restarting phase', /phase === 'restarting' \? 'Restarting' : 'Starting up'/.test(world)],
  ['Layout.ts no longer owns the lounge bounds', !/export const LOUNGE_ROOM/.test(layout)],
];
for (const [label, ok] of guards) {
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed) {
  console.error(`\n${failed} lounge check(s) failed.`);
  process.exit(1);
}
console.log('\nAll lounge checks passed: starting and restarting agents stay inside the Lounge room.');
