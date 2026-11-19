import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';

const BASE_URL = 'http://127.0.0.1:3000/';
const CHROMIUM_PATH = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';
const ASSETS_DIR = path.resolve('docs/assets');
const LOGO_BYTES = fs.readFileSync(path.join(ASSETS_DIR, 'logo.png'));

const DEMO_AGENTS = [
  {
    agentId: 'agent-01-arya',
    name: 'Arya Nugraha',
    role: 'Backend Engineer',
    avatarColor: '#60a5fa',
    avatarHue: 215,
    avatarSeed: 'arya-nugraha:face:11',
    workspaceBytes: 48_234_496,
    phase: 'working',
    activity: { kind: 'working', priority: 20 },
    unreadCount: 0,
  },
  {
    agentId: 'agent-02-kirana',
    name: 'Kirana Ayu',
    role: 'Product Designer',
    avatarColor: '#4ade80',
    avatarHue: 142,
    avatarSeed: 'kirana-ayu:face:22',
    workspaceBytes: 31_457_280,
    phase: 'working',
    activity: { kind: 'responded', priority: 60 },
    unreadCount: 0,
  },
  {
    agentId: 'agent-03-bagas',
    name: 'Bagas Prakoso',
    role: 'Frontend Developer',
    avatarColor: '#34d399',
    avatarHue: 160,
    avatarSeed: 'bagas-prakoso:face:33',
    workspaceBytes: 19_922_944,
    phase: 'ready',
    activity: { kind: 'responded', priority: 60 },
    unreadCount: 0,
  },
  {
    agentId: 'agent-04-sekar',
    name: 'Sekar Melati',
    role: 'QA Automation',
    avatarColor: '#a78bfa',
    avatarHue: 262,
    avatarSeed: 'sekar-melati:face:44',
    workspaceBytes: 14_680_064,
    phase: 'ready',
    activity: null,
    unreadCount: 0,
  },
  {
    agentId: 'agent-05-rangga',
    name: 'Rangga Wijaya',
    role: 'DevOps Engineer',
    avatarColor: '#38bdf8',
    avatarHue: 199,
    avatarSeed: 'rangga-wijaya:face:55',
    workspaceBytes: 62_914_560,
    phase: 'working',
    activity: { kind: 'working', priority: 20 },
    unreadCount: 1,
  },
  {
    agentId: 'agent-06-tiara',
    name: 'Tiara Lestari',
    role: 'Data Analyst',
    avatarColor: '#2dd4bf',
    avatarHue: 174,
    avatarSeed: 'tiara-lestari:face:66',
    workspaceBytes: 26_214_400,
    phase: 'working',
    activity: { kind: 'unread', priority: 80 },
    unreadCount: 3,
  },
  {
    agentId: 'agent-07-yoga',
    name: 'Yoga Saputra',
    role: 'Mobile Engineer',
    avatarColor: '#fbbf24',
    avatarHue: 43,
    avatarSeed: 'yoga-saputra:face:77',
    workspaceBytes: 22_020_096,
    phase: 'ready',
    activity: null,
    unreadCount: 0,
  },
  {
    agentId: 'agent-08-intan',
    name: 'Intan Permata',
    role: 'Research Lead',
    avatarColor: '#c084fc',
    avatarHue: 270,
    avatarSeed: 'intan-permata:face:88',
    workspaceBytes: 11_534_336,
    phase: 'idle',
    activity: null,
    unreadCount: 0,
  },
  {
    agentId: 'agent-09-nabila',
    name: 'Nabila Zahra',
    role: 'System Architect',
    avatarColor: '#f472b6',
    avatarHue: 330,
    avatarSeed: 'nabila-zahra:face:99',
    workspaceBytes: 17_825_792,
    phase: 'idle',
    activity: null,
    unreadCount: 0,
  },
  {
    agentId: 'agent-10-fajar',
    name: 'Fajar Ramadhan',
    role: 'Security Reviewer',
    avatarColor: '#f87171',
    avatarHue: 0,
    avatarSeed: 'fajar-ramadhan:face:101',
    workspaceBytes: 9_437_184,
    phase: 'blocked',
    activity: { kind: 'waiting', priority: 100 },
    unreadCount: 0,
  },
  {
    agentId: 'agent-11-bima',
    name: 'Bima Pratama',
    role: 'Infra Ops',
    avatarColor: '#fb923c',
    avatarHue: 28,
    avatarSeed: 'bima-pratama:face:112',
    workspaceBytes: 15_728_640,
    phase: 'restarting',
    activity: null,
    unreadCount: 0,
  },
];

async function setupRoutes(page) {
  await page.route('**/api/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEMO_AGENTS),
    }),
  );
  await page.route('**/api/office-profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Nusantara Studio' }),
    }),
  );
  await page.route('**/api/office-avatar', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'x-office-avatar-version': 'demo-v2' },
      body: LOGO_BYTES,
    }),
  );
}

async function injectPauseControl(context) {
  await context.addInitScript(() => {
    const origRaf = window.requestAnimationFrame.bind(window);
    const pending = [];
    window.__pauseRaf = false;
    window.requestAnimationFrame = (cb) => {
      if (window.__pauseRaf) {
        pending.push(cb);
        return 0;
      }
      return origRaf(cb);
    };
    window.__setRafPaused = (paused) => {
      window.__pauseRaf = paused;
      if (!paused && pending.length) {
        const list = pending.splice(0, pending.length);
        for (const fn of list) origRaf(fn);
      }
    };
  });
}

async function snap(page, filePath, options = {}) {
  await page.evaluate(() => window.__setRafPaused(true));
  await page.waitForTimeout(80);
  try {
    await page.screenshot({ path: filePath, animations: 'disabled', timeout: 30000, ...options });
  } finally {
    await page.evaluate(() => window.__setRafPaused(false));
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  try {
    // -----------------------------------------------------------------------
    // Part A: High-resolution 2x screenshots (1600x1000 @ DPR 2 -> 3200x2000)
    // -----------------------------------------------------------------------
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    await injectPauseControl(ctx);
    const page = await ctx.newPage();
    await setupRoutes(page);

    // Seed clean initial localStorage before loading
    await page.addInitScript(() => {
      localStorage.removeItem('ovo-view');
      localStorage.removeItem('ovo-agent-poses');
      localStorage.setItem('ovo-floor', 'oak');
      localStorage.setItem('ovo-plant', 'mixed');
      localStorage.setItem('ovo-moody-lighting', 'true');
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.source-badge[data-source="openbot"]');
    // Let agents settle into seats / chat spots
    await page.waitForTimeout(4500);

    // Helper to set select by label text inside Settings
    const openSettings = async () => {
      const toggle = page.locator('.settings-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
      }
    };
    const closeSettings = async () => {
      const toggle = page.locator('.settings-toggle');
      if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.click();
      }
    };
    const setSelect = async (labelText, value) => {
      const select = page.locator('.settings-select', { hasText: labelText }).locator('select');
      await select.selectOption(value);
    };

    await openSettings();
    await setSelect('Theme', 'dark');
    await setSelect('Atmosphere', 'day');
    await setSelect('Floor style', 'oak');
    await setSelect('Plant style', 'mixed');
    await setSelect('Sidebar font', 'mono');
    await closeSettings();
    await page.waitForTimeout(800);

    // 1. sidebar.png — expand Working row for a rich roster view
    const workingRow = page.locator('.status-row', { hasText: 'Working' });
    await workingRow.click();
    await page.waitForTimeout(250);
    const sidebarBox = await page.locator('.hud-sidebar').boundingBox();
    await snap(page, path.join(ASSETS_DIR, 'sidebar.png'), {
      clip: {
        x: Math.max(0, sidebarBox.x - 16),
        y: Math.max(0, sidebarBox.y - 16),
        width: sidebarBox.width + 32,
        height: sidebarBox.height + 32,
      },
    });
    console.log('Captured sidebar.png');

    // 2. agent-panel.png & 3. info-panel.png — select Tiara Lestari
    await page.locator('.status-members button', { hasText: 'Tiara Lestari' }).click();
    await page.waitForSelector('.panel.info');
    await page.waitForTimeout(700);
    await snap(page, path.join(ASSETS_DIR, 'agent-panel.png'));
    console.log('Captured agent-panel.png');

    const infoBox = await page.locator('.panel.info').boundingBox();
    await snap(page, path.join(ASSETS_DIR, 'info-panel.png'), {
      clip: {
        x: Math.max(0, infoBox.x - 16),
        y: Math.max(0, infoBox.y - 16),
        width: infoBox.width + 32,
        height: infoBox.height + 32,
      },
    });
    console.log('Captured info-panel.png');

    // Clear selection & collapse Working row
    await page.locator('.panel.info .close-btn').click();
    await workingRow.click();

    // 4. office-overview.png — full canvas with sidebar hidden
    await page.locator('.sidebar-hide-button').click();
    await page.locator('.stage-zoom-readout').click(); // reset 75% center
    await page.waitForTimeout(1000);
    await snap(page, path.join(ASSETS_DIR, 'office-overview.png'));
    console.log('Captured office-overview.png');

    // 5. night-moody-lighting.png — Night + Moody night lighting ON
    await page.locator('.sidebar-reopen-button').click();
    await openSettings();
    await setSelect('Atmosphere', 'night');
    const moodyCheckbox = page.locator('.settings-option', { hasText: 'Moody night lighting' }).locator('input[type="checkbox"]');
    if (!(await moodyCheckbox.isChecked())) await moodyCheckbox.check();
    await closeSettings();
    await page.locator('.sidebar-hide-button').click();
    await page.waitForTimeout(1200);
    await snap(page, path.join(ASSETS_DIR, 'night-moody-lighting.png'));
    console.log('Captured night-moody-lighting.png');

    // 6. settings-customization.png — Settings open with Herringbone floor, Assorted Mix plants, Geist Pixel, Dusk atmosphere
    await page.locator('.sidebar-reopen-button').click();
    await openSettings();
    await setSelect('Atmosphere', 'dusk');
    await setSelect('Floor style', 'herringbone');
    await setSelect('Plant style', 'mixed');
    await setSelect('Sidebar font', 'pixel');
    await page.waitForTimeout(900);
    await snap(page, path.join(ASSETS_DIR, 'settings-customization.png'));
    console.log('Captured settings-customization.png');

    // 7. room-navigation.png — Day + Warm Oak, click Meeting quick-jump (125% + 3s flash box)
    await setSelect('Atmosphere', 'day');
    await setSelect('Floor style', 'oak');
    await setSelect('Sidebar font', 'mono');
    await closeSettings();
    await page.locator('.sidebar-hide-button').click();
    await page.waitForTimeout(300);
    await page.locator('.stage-rooms button', { hasText: 'Meeting' }).click();
    await page.waitForTimeout(650);
    await snap(page, path.join(ASSETS_DIR, 'room-navigation.png'));
    console.log('Captured room-navigation.png');

    await ctx.close();

    // -----------------------------------------------------------------------
    // Part B: 10s timelapse GIF at DPR 1 (smooth software WebGL recording)
    // -----------------------------------------------------------------------
    const vidDir = '/tmp/ovo-vid';
    fs.rmSync(vidDir, { recursive: true, force: true });
    fs.mkdirSync(vidDir, { recursive: true });

    const vidCtx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      recordVideo: { dir: vidDir, size: { width: 1600, height: 1000 } },
    });
    const vidPage = await vidCtx.newPage();
    await setupRoutes(vidPage);
    await vidPage.addInitScript(() => {
      localStorage.removeItem('ovo-view');
      localStorage.removeItem('ovo-agent-poses');
      localStorage.setItem('ovo-floor', 'oak');
      localStorage.setItem('ovo-plant', 'mixed');
      localStorage.setItem('ovo-moody-lighting', 'true');
    });
    await vidPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await vidPage.waitForSelector('.source-badge[data-source="openbot"]');
    const vidOpenSettings = async () => {
      const t = vidPage.locator('.settings-toggle');
      if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    };
    await vidOpenSettings();
    await vidPage.locator('.settings-select', { hasText: 'Atmosphere' }).locator('select').selectOption('day');
    await vidPage.locator('.settings-toggle').click();
    await vidPage.locator('.sidebar-hide-button').click();
    // Let agents walk, type, chat, steam animate for ~12s cleanly
    await vidPage.waitForTimeout(12000);
    const videoPath = await vidPage.video().path();
    await vidCtx.close();

    const gifPath = path.join(ASSETS_DIR, 'office-activity.gif');
    execFileSync('ffmpeg', [
      '-y',
      '-ss', '2',
      '-t', '10',
      '-i', videoPath,
      '-vf', 'fps=10,scale=640:400:flags=neighbor,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=none',
      gifPath,
    ], { stdio: 'inherit' });
    console.log('Captured office-activity.gif');
    fs.rmSync(vidDir, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
