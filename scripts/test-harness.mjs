import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from './lib.mjs';

// This drives the actual Anna dashboard/iframe. There is no Host API mock here.
const p0 = process.argv.includes('--p0');
const url = process.env.HARNESS_URL ?? 'http://127.0.0.1:5180/';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const rpc = [], consoleErrors = [], httpErrors = [], hostWarnings = [];
const responses = [], responseErrors = [];
let liveSdkHash;
page.on('console', event => {
  if (event.type() !== 'error') return;
  const detail = { message: event.text(), url: event.location().url };
  // Confirmed vendor dashboard request, outside the App bundle; retain as evidence.
  if (detail.url === new URL('/favicon.ico', url).href && detail.message.includes('404')) hostWarnings.push(detail);
  else consoleErrors.push(detail);
});
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('response', response => {
  if (response.url().endsWith('/static/anna-apps/_sdk/latest/index.js')) responses.push((async () => {
    liveSdkHash = createHash('sha256').update(await response.body()).digest('hex');
  })().catch(error => responseErrors.push(String(error))));
  if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
  if (!response.url().endsWith('/api/session/call')) return;
  const pending = (async () => {
    const request = response.request().postDataJSON();
    // Only test notes and API envelopes are retained; omit session tokens/IDs.
    rpc.push({ ns: request.ns, method: request.method, args: request.args, response: await response.json() });
  })();
  responses.push(pending.catch(error => responseErrors.push(String(error))));
});
await mkdir(resolve(ROOT, 'evidence'), { recursive: true });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const app = page.frameLocator('#app');
  await app.getByRole('heading', { name: 'Mini Notes', exact: true }).waitFor();
  await expect(page).toHaveTitle(/Anna|Harness/);
  if (p0) {
    await app.getByRole('button', { name: '验证平台契约' }).click();
    await app.getByTestId('p0-result').filter({ hasText: 'P0 storage verified' }).waitFor();
    await app.getByRole('button', { name: '验证工具路由' }).click();
    await app.getByTestId('p0-tool-result').filter({ hasText: /harness started with --no-llm/ }).waitFor();
  } else {
    const composer = app.getByRole('textbox', { name: '笔记内容' });
    await composer.fill('   ');
    assert.equal(await app.getByRole('button', { name: '保存笔记', exact: true }).isDisabled(), true);
    for (const [index, content] of ['明天联系客户', '修复登录 bug'].entries()) {
      await composer.fill(content);
      await app.getByRole('button', { name: '保存笔记', exact: true }).click();
      await expect(app.getByTestId(`note-${index + 1}`)).toContainText(content);
      await expect(composer).toHaveValue('');
    }
    await app.getByRole('button', { name: '删除笔记 1', exact: true }).click();
    await app.getByTestId('note-1').waitFor({ state: 'hidden' });
    await expect(composer).toBeEditable();
    await composer.fill('整理 Workshop 想法');
    await app.getByRole('button', { name: '保存笔记', exact: true }).click();
    await expect(app.getByTestId('note-3')).toContainText('整理 Workshop 想法');
    await expect(composer).toHaveValue('');
    await app.getByRole('button', { name: '重新读取', exact: true }).click();
    await app.getByTestId('note-2').waitFor(); await app.getByTestId('note-3').waitFor();
    await app.getByRole('button', { name: 'Summarize', exact: true }).click();
    await app.getByRole('alert').filter({ hasText: /harness started with --no-llm/ }).waitFor();
  }
  await Promise.all(responses);
  assert.deepEqual(responseErrors, []);
  const localSdkHash = createHash('sha256').update(await readFile(resolve(ROOT, 'node_modules/@anna-ai/app-runtime/dist/index.js'))).digest('hex');
  assert.equal(liveSdkHash, localSdkHash, 'actual harness SDK must match locked npm file');
  assert(rpc.some(row => row.ns === 'storage' && row.method === 'get'));
  assert(rpc.some(row => row.ns === 'storage' && row.method === 'set'));
  const tool = rpc.findLast(row => row.ns === 'tools' && row.method === 'invoke');
  assert(tool); assert.equal(tool.args.tool_id, 'mini-notes-summarizer');
  assert.equal(tool.args.method, 'summarize');
  if (!p0) assert.deepEqual(tool.args.args.notes, ['修复登录 bug', '整理 Workshop 想法']);
  assert.equal(rpc.filter(row => row.ns === 'llm').length, 0, 'iframe must never call llm directly');
  const name = p0 ? 'p0' : 'ui';
  await writeFile(resolve(ROOT, `evidence/${name}-host-rpc.jsonl`), rpc.map(row => JSON.stringify(row)).join('\n') + '\n');
  await app.locator('body').evaluate(body => body.ownerDocument.defaultView.scrollTo(0, 0));
  await page.locator('#app').screenshot({ path: resolve(ROOT, `evidence/${name}-harness.png`) });
  if (!p0) {
    await page.locator('#app').evaluate(frame => { frame.style.width = '360px'; frame.style.maxWidth = '360px'; });
    await expect.poll(() => app.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
    await page.locator('#app').screenshot({ path: resolve(ROOT, 'evidence/ui-harness-narrow.png') });
  }
  assert.equal(consoleErrors.length, 0, JSON.stringify({ consoleErrors, httpErrors }));
  await writeFile(resolve(ROOT, `evidence/${name}-harness-report.json`), JSON.stringify({ url, browser: 'Playwright; Browser plugin not available', actualAnnaHarness: true, passed: true, consoleErrors, hostWarnings, rpcCount: rpc.length, liveSdkHash }, null, 2));
  console.log(`${name} actual Anna iframe/storage/tools wiring: PASS (${rpc.length} Host calls)`);
} catch (error) {
  await page.screenshot({ path: resolve(ROOT, 'evidence/ui-failure.png') }).catch(() => {});
  console.error('App state:', await page.frameLocator('#app').locator('body').innerText().catch(() => 'unavailable'));
  throw error;
} finally { await Promise.all(responses); await browser.close(); }
