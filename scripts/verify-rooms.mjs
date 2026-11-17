// Verifies the room swap aftermath: the pantry carpet moved with the room, the
// pantry shelf wall is evenly spaced, and the NOC reads as a server room (raised
// floor, CRAC, UPS, patch panels) with every prop footprint on the collision
// grid and tall props clear of the wall above.
// Run with: node --import ./scripts/register-ts.mjs scripts/verify-rooms.mjs
import { readFileSync } from 'node:fs';
import { buildLayout } from '../src/office/Layout.ts';
import { PROP, TILE } from '../src/constants.ts';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
};

const layout = buildLayout(12);
const blocked = layout.blocked;
const row = (ty) => blocked[ty].slice(1, 14).map((b) => (b ? '#' : '.')).join('');

// --- Lounge (upper-left room, rows 6-15, cols 1-13)
check('lounge sofa spans cols 4-9 with plants flanking', row(8) === '##.######..##', row(8));
check('lounge coffee table is centred', row(10) === '....####.....', row(10));
check('lounge loveseats sit on row 13', row(13) === '####.....####', row(13));
check('lounge walk lanes stay open on rows 9 and 14', row(9) === '.............' && row(14) === '.............');
check(
  'lounge has seven seats (3 sofa + 4 loveseat)',
  layout.seats.filter((s) => s.kind === 'lounge' && s.id.startsWith('L')).length === 7,
);

// --- Pantry (upper-left room, rows 17-29, cols 1-13)
check('pantry shelf row sits on row 20 with gutters at col 5 and col 10', row(20) === '####.####.##.', row(20));
check('pantry aisle above the shelves is walkable', row(18) === '.............', row(18));
check('pantry dining table is centred', row(24) === '....####.....', row(24));
check(
  'pantry label plate sits on free tiles',
  layout.roomLabels.some((l) => l.name.startsWith('PANTRY') && !blocked[l.ty][l.tx]),
);

// --- NOC (lower-left room, rows 31-38, cols 1-13)
check('NOC has two racks, a CRAC and a UPS on row 36', row(36) === '.####..##.##.', row(36));
check('NOC walk lanes stay open on row 36', [6, 7, 10, 13].every((tx) => !blocked[36][tx]));
check('NOC wall row carries patch panels', row(31) === '......##.##..', row(31));
check('NOC racks stay off the pantry wall row', row(32) === '.............', row(32));

// --- Every prop footprint matches its art width on the collision grid
const ART = {
  desk: [32, 28], bookshelf: [32, 44], cabinet: [16, 36], fridge: [16, 38],
  dispenser: [16, 30], storageTable: [48, 22], meetingTable: [64, 36], diningTable: [32, 20],
  serverRack: [16, 38], crac: [16, 32], ups: [16, 16], switchBox: [16, 8],
  plant: [16, 22], coffeeTable: [32, 16], sofa3Down: [48, 26], sofa2Up: [32, 26],
};
const SHELL = new Set(['partitionH', 'partitionV', 'partitionHHalf', 'partitionCorner', 'doorH', 'doorV', 'whiteboard', 'chairUp', 'chairDown']);
for (const f of layout.furniture) {
  if (SHELL.has(f.type) || !ART[f.type]) continue;
  const [aw, ah] = ART[f.type];
  const w = Math.max(1, Math.round((aw * PROP) / TILE));
  const baseTy = f.y / TILE - 1;
  const left = Math.floor((f.x - (w * TILE) / 2) / TILE);
  // Only the two left-hand rooms are in scope: the Lounge sofas and desks draw
  // a wider sprite than their collision footprint on purpose, which is their
  // own regression test's business.
  if (left < 1 || left + w > 14 || !((baseTy >= 17 && baseTy <= 29) || (baseTy >= 31 && baseTy <= 38))) continue;
  const footprint = Array.from({ length: w }, (_, i) => blocked[baseTy][left + i]);
  check(`${f.type} at (${left},${baseTy}) blocks its ${w}-tile footprint`, footprint.every(Boolean), footprint.map((b) => (b ? '#' : '.')).join(''));
  const topRow = (f.y - ah * PROP) / TILE;
  if (baseTy >= 31)
    check(`${f.type} clears the NOC ceiling`, topRow >= 30.99, `top row ${topRow.toFixed(2)}`);
}

// --- Assets and background source guards
const art = readFileSync(new URL('../src/office/AssetGenerator.ts', import.meta.url), 'utf8');
const layoutSrc = readFileSync(new URL('../src/office/Layout.ts', import.meta.url), 'utf8');
const guards = [
  ['pantry carpet moved to the upper room', /rug\(c, 4, 22, 7, 6, '#7a8a5a', '#4e5a38'\)/.test(art)],
  ['pantry shelves sit two tiles below the top wall', /place\("bookshelf", 1, 20, 4, 1\)/.test(layoutSrc)],
  ['no carpet left in the old pantry spot', !/rug\(c, 3, 35, 8, 4/.test(art)],
  ['NOC draws a raised floor', /NOC raised floor/.test(art) && /for \(let ty = 31; ty <= 38; ty\+\+\)/.test(art)],
  ['CRAC sprite is 2x4 tiles at the prop scale', /crac: make\(16, 32/.test(art)],
  ['UPS sprite is 2x2 tiles at the prop scale', /ups: make\(16, 16/.test(art)],
  ['patch panel sprite is 2x1 tiles at the prop scale', /switchBox: make\(16, 8/.test(art)],
  ['furniture union lists the server-room props', /'serverRack' \| 'crac' \| 'ups' \| 'switchBox'/.test(art)],
  ['place()/block() reject fractional tiles', /Number\.isInteger\(tx\)/.test(layoutSrc)],
  ['no fractional place() call is left', !/place\("[a-z]+", \d+\.\d+/.test(layoutSrc)],
];
for (const [label, ok] of guards) check(label, ok);

if (failed) {
  console.error(`\n${failed} room check(s) failed.`);
  process.exit(1);
}
console.log('\nAll room checks passed: lounge ringed round its table, carpet moved, pantry evenly spaced, NOC dressed as a server room.');
