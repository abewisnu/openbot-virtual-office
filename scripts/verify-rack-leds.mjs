// Verifies the NOC rack LEDs: eight lamps (two racks x four server units), each
// with its own random phase, and a blink speed that gains one notch per
// `working` agent and stops at the cap instead of accelerating forever.
// Run with: node --import ./scripts/register-ts.mjs scripts/verify-rack-leds.mjs
import { makeRackLeds, rackBlinkRate } from '../src/office/AssetGenerator.ts';
import {
  PROP,
  RACK_BLINK_BASE,
  RACK_BLINK_MAX,
  RACK_BLINK_STEP,
  RACK_COLS,
  RACK_ROWS,
} from '../src/constants.ts';

let failed = 0;
let passed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name} — ${detail}`);
  }
};

// 1. One lamp per server unit, on every rack.
const leds = makeRackLeds(PROP, 2);
const racks = RACK_ROWS.length * RACK_COLS.length;
check('LED count = racks x 4 server units', leds.length === racks * 4, `${leds.length} lamps for ${racks} racks`);

// 2. Phases are random: distinct within one panel and spread over the full turn.
check('phases distinct within one panel', new Set(leds.map((l) => l.phase.toFixed(6))).size === leds.length, 'duplicate phase');
const firstPhases = Array.from({ length: 200 }, () => makeRackLeds(PROP, 2)[0].phase);
const low = Math.min(...firstPhases);
const high = Math.max(...firstPhases);
check('phase covers the whole turn', low < 0.5 && high > Math.PI * 2 - 0.5, `min ${low.toFixed(2)} max ${high.toFixed(2)}`);
check(
  'phase is not a fixed staircase',
  new Set(firstPhases.map((p) => p.toFixed(3))).size > 190,
  `${new Set(firstPhases.map((p) => p.toFixed(3))).size} distinct phases in 200 builds`,
);
check('phase stays inside [0, 2pi)', leds.every((l) => l.phase >= 0 && l.phase < Math.PI * 2), 'phase out of range');

// 3. Per-lamp rate jitter stays subtle (<= +/-10%) so the panel reads as one system.
check('rate jitter is subtle', leds.every((l) => l.rate >= 0.9 && l.rate < 1.1), 'jitter outside 0.9..1.1');

// 4. Speed answers the workload: base at zero, one step per working agent, capped.
const rates = [0, 1, 2, 3, 5, 8, 20].map((n) => rackBlinkRate(n));
check('no working agent = base rate', rackBlinkRate(0) === RACK_BLINK_BASE, `${rackBlinkRate(0)}`);
check('one working agent = one step', rackBlinkRate(1) === RACK_BLINK_BASE + RACK_BLINK_STEP, `${rackBlinkRate(1)}`);
check('rate grows with the roster', rates.every((r, i) => i === 0 || r >= rates[i - 1]), rates.join(' '));
check('rate is capped', rackBlinkRate(20) === RACK_BLINK_MAX, `${rackBlinkRate(20)}`);
check('negative or NaN count is ignored', rackBlinkRate(-3) === RACK_BLINK_BASE && rackBlinkRate(NaN) === RACK_BLINK_BASE, 'guard missing');

// 5. What the numbers mean on screen: green/red toggles per 10 s, per lamp.
const togglesPer10s = (working, led) => {
  let prev = Math.sin(led.phase) > 0;
  let n = 0;
  const rate = rackBlinkRate(working) * led.rate;
  for (let f = 1; f <= 600; f++) {
    const on = Math.sin((f / 60) * rate + led.phase) > 0;
    if (on !== prev) {
      n++;
      prev = on;
    }
  }
  return n;
};
const sample = leds[0];
const table = [0, 1, 3, 5, 8, 12].map((n) => [n, togglesPer10s(n, sample), rackBlinkRate(n)]);
check(
  'a busier office blinks more often',
  table.every((row, i) => i === 0 || row[1] >= table[i - 1][1]),
  table.map((r) => `${r[0]}:${r[1]}`).join(' '),
);
check('idle panel still blinks a few times per 10 s', table[0][1] >= 3 && table[0][1] <= 12, `${table[0][1]} toggles`);
check('busy panel stays below a strobe', table[5][1] <= 32, `${table[5][1]} toggles`);

if (process.argv.includes('--table')) {
  for (const [n, toggles, rate] of table) {
    console.log(`working ${String(n).padStart(2)}  rate ${rate.toFixed(2)} rad/s  ${toggles} toggles / 10 s`);
  }
}
console.log(`${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
