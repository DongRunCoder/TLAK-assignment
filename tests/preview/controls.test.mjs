import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { PREVIEW_CSS } from '../../scripts/responsive-preview.mjs';

// Use the installed official dashboard markup. Remove its session bootstrap
// only for this isolated rendering test; live Host wiring is tested separately.
const dashboard = (await readFile(new URL('../../node_modules/@anna-ai/cli/dist/dashboard.html', import.meta.url), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
let browser;
before(async () => {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
});
after(async () => { await browser?.close(); });

test('official debug dashboard retains its original context controls', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(dashboard);
    for (const selector of ['#ff-mobile', '#ctx-theme', '#ctx-lang', '[aria-label="Host context"]', '#ff-desktop', '#rec-btn']) {
      assert.equal(await page.locator(selector).isVisible(), true, `${selector} must remain visible in the official dashboard`);
    }
  } finally { await page.close(); }
});

test('experience preview hides unsupported controls while preserving Desktop and recording', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.setContent(dashboard.replace(/<\/head\s*>/i, `<style>${PREVIEW_CSS}</style></head>`));
    for (const selector of ['#ff-mobile', '#ctx-theme', '#ctx-lang', '[aria-label="Host context"]']) {
      assert.equal(await page.locator(selector).isVisible(), false, `${selector} must be hidden in the experience preview`);
    }
    for (const selector of ['#ff-desktop', '#rec-btn']) {
      assert.equal(await page.locator(selector).isVisible(), true, `${selector} remains visible`);
      assert.equal(await page.locator(selector).isEnabled(), true, `${selector} remains usable`);
    }
    assert.equal(await page.locator('#app').count(), 1);
  } finally { await page.close(); }
});
