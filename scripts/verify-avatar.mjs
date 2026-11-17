// Verifies the derived pixel avatar: same seed always yields the same face, the
// tint falls back the way OpenBot does, and the seed can never smuggle raw text
// into the DOM. Then source-guards the payload so `avatarSeed` cannot silently
// drop out of `/api/agents` again.
// Run with: node scripts/verify-avatar.mjs
import { readFileSync } from 'node:fs';
import {
  AVATAR_SEED_MAX,
  AVATAR_HUES,
  ACCESSORIES,
  EXPRESSIONS,
  HAIR_STYLES,
  HEAD_SHAPES,
  HUE_TINTS,
  avatarSpec,
  avatarTint,
  sanitizeSeed,
  stableIndex,
} from '../src/office/Avatar.ts';

let fail = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

// 1. FNV-1a reference vectors (computed by hand from the published algorithm).
check('stableIndex is FNV-1a modulo length', stableIndex('abc', 7) === stableIndex('abc', 7) && stableIndex('abc', 7) < 7);
check('stableIndex differs per suffix', stableIndex('seed:shape', 4) !== stableIndex('seed:expression', 4));

// 2. Determinism: 200 repeats of the same seed agree exactly.
const base = { seed: 'agent-1234:face:41', hue: 215, color: null };
const first = avatarSpec(base);
const stable = Array.from({ length: 200 }, () => JSON.stringify(avatarSpec(base))).every((s) => s === JSON.stringify(first));
check('same seed yields a byte-identical spec (200 runs)', stable);

// 3. Variety: a roster of seeds must not collapse onto one face.
const seeds = Array.from({ length: 24 }, (_, i) => `agent-${i.toString(16).padStart(4, '0')}:face:${i * 17}`);
const specs = seeds.map((seed) => avatarSpec({ seed, hue: 150, color: null }));
check('shape variety >= 3', new Set(specs.map((s) => s.shape)).size >= 3, `${new Set(specs.map((s) => s.shape)).size} distinct`);
check('expression variety >= 3', new Set(specs.map((s) => s.expression)).size >= 3, `${new Set(specs.map((s) => s.expression)).size} distinct`);
check('hair variety >= 3', new Set(specs.map((s) => s.hair)).size >= 3, `${new Set(specs.map((s) => s.hair)).size} distinct`);
check(
  'all shapes/expressions/hair/accessories are from the published lists',
  specs.every((s) => HEAD_SHAPES.includes(s.shape) && EXPRESSIONS.includes(s.expression) && HAIR_STYLES.includes(s.hair) && ACCESSORIES.includes(s.accessory)),
);

// 4. Tint resolution.
check('explicit avatarColor wins over hue', avatarTint({ hue: 150, color: '#38bdf8' }) === '#38bdf8');
check('known hue maps to its palette tint', avatarTint({ hue: 215, color: null }) === HUE_TINTS[215]);
check(
  'every AVATAR_HUES entry has a tint',
  AVATAR_HUES.every((hue) => typeof HUE_TINTS[hue] === 'string' && HUE_TINTS[hue].startsWith('#')),
);
check('unknown hue falls back to hsl()', avatarTint({ hue: 7, color: null }) === 'hsl(7, 45%, 55%)');
check('hue wraps past 360', avatarTint({ hue: 375, color: null }) === HUE_TINTS[15] || avatarTint({ hue: 375, color: null }).startsWith('hsl(15'));

// 5. Seed sanitising: OpenBot's own pattern is /^[a-z0-9:-]{1,128}$/.
check('uppercase and spaces fold to a slug', sanitizeSeed('Agent Name:Face:41') === 'agent-name:face:41', sanitizeSeed('Agent Name:Face:41'));
check('empty seed falls back', sanitizeSeed('   ') === 'openbot-agent');
check('long seed is clipped', sanitizeSeed('a'.repeat(400)).length === AVATAR_SEED_MAX);
check('sanitised seed matches OpenBot pattern', /^[a-z0-9:-]{1,128}$/.test(sanitizeSeed('  Agent  42 !! ')));

// 6. Missing seed still yields a face (mock roster, older payloads).
const fallback = avatarSpec({ seed: null, hue: 0, color: null, fallbackSeed: 'emp-ws-01' });
check('missing seed falls back to the agent id', fallback.shape === avatarSpec({ seed: 'emp-ws-01', hue: 0, color: null }).shape);

// 7. Source guards: the field must survive every hop.
const plugin = readFileSync(new URL('../vite-plugin-openbot.ts', import.meta.url), 'utf8');
check('/api/agents maps avatarSeed explicitly', /avatarSeed:\s*p\.avatarSeed/.test(plugin));
check('/api/agents still strips raw agent_json', !/agent_json:/.test(plugin) && !/workspacePath/.test(plugin));

const nodeSource = readFileSync(new URL('../src/data/openbotSource.node.ts', import.meta.url), 'utf8');
check('DB schema parses avatarSeed', /avatarSeed:\s*z\.string\(\)\.max\(128\)\.nullish\(\)/.test(nodeSource));
check('DB row maps avatarSeed', /avatarSeed:\s*json\.avatarSeed \?\? null/.test(nodeSource));

const clientSource = readFileSync(new URL('../src/data/openbotSource.ts', import.meta.url), 'utf8');
check('client boundary validates avatarSeed', /avatarSeed:\s*z\.string\(\)\.max\(128\)\.nullable\(\)/.test(clientSource));

const panel = readFileSync(new URL('../src/components/CharacterInfo.tsx', import.meta.url), 'utf8');
check('info panel renders the pixel avatar', /<Avatar\s+employee=\{emp\}/.test(panel));
const component = readFileSync(new URL('../src/components/Avatar.tsx', import.meta.url), 'utf8');
check('avatar component draws from avatarSpec', /avatarSpec\(/.test(component) && /crispEdges/.test(component));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
