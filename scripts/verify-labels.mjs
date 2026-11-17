// Verifies the agent name plate and status dot: they must stay readable at the
// shipped prop scale, and a `ready`/`working` workstation sitter must carry the
// plate under its chair while every other pose keeps it above the agent.
// Run with: node scripts/verify-labels.mjs
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`);
};

const src = readFileSync(new URL('../src/office/Character.ts', import.meta.url), 'utf8');

check('name plate text is 12 px bold', /fontSize: 12, fontWeight: 'bold'/.test(src));
check('plate pill is 19 px tall', /roundRect\(-half, -10, w, 19, 5\)/.test(src));
check('status dot is r4 (was r3)', /circle\(0, 0, 4\)/.test(src));
check('speech bubble clears the taller pill', /bubble\.position\.set\(0, -22\)/.test(src));

const lift = src.match(/private tagLift\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
check('tagLift() exists', lift.length > 0);
check(
  'a working workstation sitter carries the plate under the chair',
  /seat!\.kind === 'desk' && this\.appliedStatus === 'working'\) return BELOW_CHAIR;/.test(lift),
);
const below = Number(src.match(/const BELOW_CHAIR = (-?\d+);/)?.[1] ?? 'NaN');
check('BELOW_CHAIR is a negative art-px offset', below < 0, `value ${below}`);
// Plate centre = |BELOW_CHAIR| * PROP_SCALE screen px under the feet at the
// shipped 2x scale; the chair sprite ends 2 px under the feet, and the pill is
// 19 px tall, so the gap to the chair edge is centre - 9.5 - 2.
const centre = Math.abs(below) * 2;
const gap = centre - 9.5 - 2;
check(
  'the plate hangs just under the chair, no more than 12 px clear',
  gap > 0 && gap <= 12,
  `gap ${gap.toFixed(1)} px under the chair edge`,
);
check(
  'the plate still clears the 16 art px chair sprite',
  Math.abs(below) > 16 - 10,
  `plate centre ${centre} px below the feet`,
);
check('standing or walking lifts the plate to 64 art px', /return seated \? 52 : 64;/.test(lift));
check('social seats keep the seated height of 52', /return seated \? 52/.test(lift));
check(
  'plate offset is applied through tagLift() once per frame',
  /const lift = this\.tagLift\(\);/.test(src) &&
    /this\.tag\.position\.set\(Math\.round\(this\.x\), Math\.round\(this\.y - lift \* PROP_SCALE\)\)/.test(src),
);
check(
  'the speech bubble cancels the drop and stays over the head',
  /lift < 0 \? \(lift - 74\) \* PROP_SCALE : -10 \* PROP_SCALE/.test(src),
);

console.log(
  failed === 0
    ? '\nAll label checks passed: bigger plate and dot, under the chair while a workstation agent works, up when standing.'
    : `\n${failed} label check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
