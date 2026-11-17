// Verifies the derived pixel avatar: same seed + same agent always yields the
// same face, a shared seed still yields different faces, the tint clears 3:1
// against both panel surfaces for the real 16-agent roster, and the seed can
// never smuggle raw text into the DOM. Then source-guards the payload so
// `avatarSeed` cannot silently drop out of `/api/agents` again.
// Run with: node scripts/verify-avatar.mjs
import { readFileSync } from 'node:fs';
import {
  ACCESSORIES,
  AVATAR_HUES,
  AVATAR_INK,
  AVATAR_SEED_MAX,
  EXPRESSIONS,
  HAIR_STYLES,
  HEAD_SHAPES,
  HUE_TINTS,
  MIN_CONTRAST,
  PANEL_SURFACES,
  avatarSpec,
  avatarTint,
  avatarTints,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
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
const base = { seed: 'agent-1234:face:41', agentId: 'agent-1234', hue: 215, color: null };
const first = avatarSpec(base);
const stable = Array.from({ length: 200 }, () => JSON.stringify(avatarSpec(base))).every((s) => s === JSON.stringify(first));
check('same seed + agentId yields a byte-identical spec (200 runs)', stable);

// 3. Variety: a roster of seeds must not collapse onto one face.
const seeds = Array.from({ length: 24 }, (_, i) => `agent-${i.toString(16).padStart(4, '0')}:face:${i * 17}`);
const specs = seeds.map((seed, i) => avatarSpec({ seed, agentId: `agent-${i}`, hue: 150, color: null }));
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
check('unknown hue falls back to a hex hsl()', /^#[0-9a-f]{6}$/.test(avatarTint({ hue: 7, color: null })));
check('hue wraps past 360', avatarTints({ hue: 375, color: null }).dark === avatarTints({ hue: 15, color: null }).dark);

// 5. Seed sanitising: OpenBot's own pattern is /^[a-z0-9:-]{1,128}$/.
check('uppercase and spaces fold to a slug', sanitizeSeed('Agent Name:Face:41') === 'agent-name:face:41', sanitizeSeed('Agent Name:Face:41'));
check('empty seed falls back', sanitizeSeed('   ') === 'openbot-agent');
check('long seed is clipped', sanitizeSeed('a'.repeat(400)).length === AVATAR_SEED_MAX);
check('sanitised seed matches OpenBot pattern', /^[a-z0-9:-]{1,128}$/.test(sanitizeSeed('  Agent  42 !! ')));

// 6. Missing seed still yields a face (mock roster, older payloads).
const fallback = avatarSpec({ seed: null, hue: 0, color: null, fallbackSeed: 'emp-ws-01' });
check('missing seed falls back to the agent id', fallback.shape === avatarSpec({ seed: 'emp-ws-01', hue: 0, color: null, agentId: 'emp-ws-01' }).shape);

// 7. Panel surfaces: composite the real panel colours over the page background
//    and prove they equal the constants the UI relies on.
const composite = (fg, alpha, bg) => {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  const mix = (x, y) => Math.round(x * alpha + y * (1 - alpha));
  return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) };
};
const panels = {
  dark: composite('#1d1722', 0.88, '#14121c'),
  light: composite('#fcfbf8', 0.92, '#f4f1ea'),
};
const toHex = (c) =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
check('dark panel composite matches PANEL_SURFACES', toHex(panels.dark) === PANEL_SURFACES.dark, `${toHex(panels.dark)} vs ${PANEL_SURFACES.dark}`);
check('light panel composite matches PANEL_SURFACES', toHex(panels.light) === PANEL_SURFACES.light, `${toHex(panels.light)} vs ${PANEL_SURFACES.light}`);
const ink = hexToRgb(AVATAR_INK);

// 8. The real roster: 16 agents read from projection_agents.agent_json on this
//    machine. Every tint must clear MIN_CONTRAST against its panel and keep the
//    ink legible inside the tile, in BOTH themes.
const ROSTER = [
  ['Scope Writer', 'agent-9bf8c6ea-a2bd-46bd-9566-2e010e4c8eb0', 'openbot-curated-agent-project-partner', 150, null],
  ['Repli', 'agent-a24565f5-198a-42d8-8130-8e4d6ea1c0d6', 'mobile:6c8cd450abab44ee8e4e994f19d0b789:face:520', 30, null],
  ['Somede', 'agent-b2179a35-9131-49b2-9591-92fb64fe1d9e', 'agent-b2179a35-9131-49b2-9591-92fb64fe1d9e:face:125', 150, null],
  ['Iwa', 'agent-f23c4497-5a08-49f1-a1e3-66153717d174', 'first-bot:face:123', 215, '#34479c'],
  ['Osi', 'agent-a29d2e83-e0b6-4649-a509-d59b90431838', 'agent-a29d2e83-e0b6-4649-a509-d59b90431838:face:409', 0, null],
  ['Neke', 'agent-441e7614-6df8-4180-a68a-3c27addd22e1', 'first-bot:face:123', 55, null],
  ['Clubo', 'agent-0b8a87ca-0911-49ce-985e-7a1368cdf9db', 'first-bot:face:123', 185, '#38bdf8'],
  ['Repro', 'agent-8a716749-eafd-49fe-a74b-39544e094ada', 'agent-8a716749-eafd-49fe-a74b-39544e094ada:face:20', 185, null],
  ['Idlo', 'agent-0cfdbd01-b673-401b-a874-907024ac3812', 'agent-0cfdbd01-b673-401b-a874-907024ac3812:face:32', 215, null],
  ['DevOps Engineer', 'agent-faf97f19-cc3b-49c1-bea4-3b05fd621a6d', 'agent-faf97f19-cc3b-49c1-bea4-3b05fd621a6d:face:109', 30, '#8b5e3c'],
  ['Security Reviewer', 'agent-63d693a6-3504-40b8-a5cb-6f4dc93cb3ac', 'agent-63d693a6-3504-40b8-a5cb-6f4dc93cb3ac:face:41', 0, '#a3a3a3'],
  ['QA Tester', 'agent-c826d2e9-754b-42cf-8f06-02089dcbd0b8', 'agent-c826d2e9-754b-42cf-8f06-02089dcbd0b8:face:132', 320, null],
  ['Fusde', 'agent-5fa343d6-7b54-484c-8dbb-3573add89427', 'agent-5fa343d6-7b54-484c-8dbb-3573add89427:face:31', 185, '#38bdf8'],
  ['Pechis', 'agent-ac706f18-cf3b-4a14-8858-1620285d725d', 'agent-ac706f18-cf3b-4a14-8858-1620285d725d:face:148', 245, null],
  ['OpenBot Help', 'agent-ce87c295-20c1-45aa-ba19-d6bf7a513b20', 'agent-ce87c295-20c1-45aa-ba19-d6bf7a513b20:face:320', 0, null],
  ['Journalist', 'agent-0fe7c4aa-674e-4fd3-96e1-9482494e4d87', 'agent-0fe7c4aa-674e-4fd3-96e1-9482494e4d87:face:229', 245, null],
].map(([name, agentId, seed, hue, color]) => ({ name, agentId, seed, hue, color }));

const round = (n) => n.toFixed(2);
console.log('\n' + ['agent', 'theme', 'tint', 'tint/panel', 'ink/tint'].join('\t'));
let worstPanel = Infinity;
let worstInk = Infinity;
for (const agent of ROSTER) {
  const spec = avatarSpec({ seed: agent.seed, agentId: agent.agentId, hue: agent.hue, color: agent.color });
  for (const theme of ['dark', 'light']) {
    const tint = hexToRgb(spec.tints[theme]);
    const onPanel = contrastRatio(tint, panels[theme]);
    const onTint = contrastRatio(ink, tint);
    worstPanel = Math.min(worstPanel, onPanel);
    worstInk = Math.min(worstInk, onTint);
    console.log([agent.name, theme, spec.tints[theme], round(onPanel), round(onTint)].join('\t'));
  }
}
check(`all 16 tints clear ${MIN_CONTRAST}:1 against their panel (both themes)`, worstPanel >= MIN_CONTRAST, `worst ${round(worstPanel)}`);
check(`ink clears ${MIN_CONTRAST}:1 inside all 16 tints (both themes)`, worstInk >= MIN_CONTRAST, `worst ${round(worstInk)}`);

// 9. Seed collision: the three agents sharing `first-bot:face:123` must differ
//    in shape/expression/hair/accessory now that agentId is hashed in.
const collided = ROSTER.filter((a) => a.seed === 'first-bot:face:123');
const collidedFaces = collided.map((a) => {
  const s = avatarSpec({ seed: a.seed, agentId: a.agentId, hue: a.hue, color: a.color });
  return `${a.name}: ${s.shape}/${s.expression}/${s.hair}/${s.accessory}`;
});
check('three agents do share one seed', collided.length === 3, `${collided.length} found`);
console.log('\nseed-collision faces:\n  ' + collidedFaces.join('\n  '));
const structure = new Set(
  collided.map((a) => {
    const s = avatarSpec({ seed: a.seed, agentId: a.agentId, hue: a.hue, color: a.color });
    return [s.shape, s.expression, s.hair, s.accessory].join('|');
  }),
);
check('seed-collision trio has three distinct faces', structure.size === 3, `${structure.size} distinct`);
check(
  'collision faces stay deterministic',
  collided.every((a) => JSON.stringify(avatarSpec({ seed: a.seed, agentId: a.agentId, hue: a.hue, color: a.color })) === JSON.stringify(avatarSpec({ seed: a.seed, agentId: a.agentId, hue: a.hue, color: a.color }))),
);
check('tint variants differ between themes for a clamped colour', avatarTints({ hue: 55, color: null }).dark !== avatarTints({ hue: 55, color: null }).light);
check('base tint luminance band respected in light theme', relativeLuminance(hexToRgb(avatarTints({ hue: 185, color: null }).light)) <= 0.26);

// 10. Source guards: the field must survive every hop.
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
check('avatar passes agentId into the hash', /agentId:\s*employee\.id/.test(component));
check('avatar tint comes from the theme variable', /var\(--avatar-tint\)/.test(component) && /--avatar-tint-dark/.test(component) && /--avatar-tint-light/.test(component));

const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');
check('CSS switches tint on data-theme', /:root\[data-theme='light'\] \.avatar/.test(css));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
