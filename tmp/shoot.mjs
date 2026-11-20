#!/usr/bin/env node
/* eslint-disable */
// Screenshot tooling for docs/assets.
//
// Captures the three documented frames (sidebar, settings-customization,
// agent-panel) from a running dev server. Requires a Playwright install; this
// machine does not have a standalone one, so the copy bundled with the global
// @playwright/mcp package is used (override with PLAYWRIGHT_PATH).
//
// Usage: node tmp/shoot.mjs            (dev server must be reachable; OVO_URL
//                                       defaults to http://localhost:3003)
//
// The store is exposed to the page through window.__OVO_STORE__ (dev-only
// handle in src/main.tsx) so the Settings frame can be reproduced. Every frame
// pins the dark palette through setThemeMode('dark') (applied by App.tsx).

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('/usr/local/lib/node_modules/noop');
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH ??
    '/Users/abewisnu/.nvm/versions/node/v24.15.0/lib/node_modules/@playwright/mcp/node_modules/playwright',
);

const BASE = process.env.OVO_URL ?? 'http://localhost:3003';
const OUT = '/Users/abewisnu/OpenBot/Shared/development/openbot-virtual-office/docs/assets';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.source-badge');
      return el && el.textContent !== 'Connecting';
    },
    { timeout: 20000 },
  );
  await sleep(1500);
}

/** Pin the dark palette through the store handle and wait for the repaint. */
async function pinDark(page) {
  await page.evaluate(() => {
    const s = window.__OVO_STORE__;
    if (!s) return;
    s.getState().setThemeMode('dark');
  });
  await sleep(600);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log('theme:', theme);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
});

async function newPage() {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on('console', (m) => console.log('[page]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return page;
}

async function selectReadyAgent(page) {
  // Expand every phase so the roster rows exist, then pick the first Ready
  // agent (the live DB may have no Working agent at capture time).
  await page.evaluate(() => {
    for (const row of document.querySelectorAll('.status-row')) row.click();
  });
  await sleep(300);
  const clicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.status-row')].find((r) =>
      r.textContent.includes('Ready'),
    );
    if (!row) return false;
    const btn = row.parentElement.parentElement.querySelector(
      '.status-members li button',
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log('ready agent clicked:', clicked);
  await sleep(1400);
}

try {
  // ---- 1. sidebar.png (element crop) --------------------------------------
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await ready(page);
    await pinDark(page);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.status-row')].find((r) =>
        r.textContent.includes('Ready'),
      );
      if (row) row.click();
    });
    await sleep(500);
    const side = await page.$('.hud-sidebar');
    await side.screenshot({ path: join(OUT, 'sidebar.png') });
    console.log('sidebar.png done');
    await page.close();
  }

  // ---- 2. settings-customization.png --------------------------------------
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await ready(page);
    const hasStore = await page.evaluate(() => Boolean(window.__OVO_STORE__));
    console.log('store handle:', hasStore);
    await pinDark(page);
    await page.evaluate(() => {
      const s = window.__OVO_STORE__;
      if (!s) return;
      s.getState().setSettings(true);
      s.getState().setDaylightMode('dusk');
      s.getState().setFloorStyle('herringbone');
      s.getState().setPlantStyle('mixed');
      s.getState().setSidebarFont('pixel');
    });
    await sleep(1500);
    await page.screenshot({ path: join(OUT, 'settings-customization.png') });
    console.log('settings-customization.png done');
    await page.close();
  }

  // ---- 3. agent-panel.png -------------------------------------------------
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await ready(page);
    await pinDark(page);
    await selectReadyAgent(page);
    await page.screenshot({ path: join(OUT, 'agent-panel.png') });
    console.log('agent-panel.png done');
    await page.close();
  }
} finally {
  await browser.close();
}