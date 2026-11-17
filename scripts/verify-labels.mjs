// Verifies the agent name plate and status dot: they must stay readable at the
// shipped prop scale, and the plate must drop onto a workstation agent while it
// works and lift again when that agent stands or walks.
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
  'a working workstation sitter carries the plate at 44 art px',
  /seat!\.kind === 'desk' && this\.appliedStatus === 'working'\) return 44;/.test(lift),
);
check('standing or walking lifts the plate to 64 art px', /return seated \? 52 : 64;/.test(lift));
check('social seats keep the seated height of 52', /return seated \? 52/.test(lift));
check(
  'plate height is applied through tagLift()',
  /this\.tag\.position\.set\(Math\.round\(this\.x\), Math\.round\(this\.y - this\.tagLift\(\) \* PROP_SCALE\)\)/.test(src),
);

console.log(
  failed === 0
    ? '\nAll label checks passed: bigger plate and dot, low over a working desk, up when standing.'
    : `\n${failed} label check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
