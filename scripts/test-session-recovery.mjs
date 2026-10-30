import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { appendFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, annaCommand, environment } from './lib.mjs';
import { stopChildTree } from './preview.mjs';
import { startResponsivePreview } from './responsive-preview.mjs';

// Actual independent Host: creating the second dashboard really closes the
// first session. Fault injection below drops acknowledgements, not Host data.
const bundleArg = process.argv.indexOf('--bundle');
const bundle = bundleArg < 0 ? resolve(ROOT, 'bundle') : resolve(process.argv[bundleArg + 1]);
await mkdir(resolve(ROOT, '.tools'), { recursive: true });
const directory = await mkdtemp(resolve(ROOT, '.tools/session-recovery-'));
await cp(bundle, resolve(directory, 'bundle'), { recursive: true });
const reserve = net.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const hostPort = reserve.address().port; await new Promise(resolveClose => reserve.close(resolveClose));
const urlHost = `http://127.0.0.1:${hostPort}/`;
let host, preview, browser, phase = 'startup';
const result = { actualAnnaHarness: true, browser: 'Playwright; Browser plugin not available', checks: [], passed: false };
const mark = name => { result.checks.push(name); console.log(`Session recovery: ${name}: PASS`); };
async function startHost() {
  const [command, args] = annaCommand(['dev', '--no-llm', '--storage', 'legacy', '--bundle', resolve(directory, 'bundle'), '--port', String(hostPort)]);
  host = spawn(command, args, { cwd: ROOT, env: environment(), stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (host.exitCode !== null) throw new Error('Test Host stopped');
    try { if ((await fetch(urlHost, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
  }
  throw new Error('Test Host startup timeout');
}
async function dismissGuide(app) {
  const button = app.getByRole('button', { name: '开始记笔记', exact: true });
  await button.waitFor({ state: 'visible', timeout: 5000 }); await button.click();
}
try {
  await startHost(); preview = await startResponsivePreview({ hostPort, port: 0 });
  const url = `http://127.0.0.1:${preview.port}/`;
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(), other = await context.newPage();
  const app = page.frameLocator('#app');
  const composer = app.getByRole('textbox', { name: '笔记内容' });
  const save = app.getByRole('button', { name: '保存笔记', exact: true });
  const recovery = app.getByRole('button', { name: '保留草稿并恢复会话', exact: true });
  let creates = 0, writes = 0, navigations = 0;
  page.on('framenavigated', frame => { if (frame.parentFrame()) navigations++; });
  for (const tab of [page, other]) tab.on('request', request => {
    if (new URL(request.url()).pathname === '/api/session/create') creates++;
    if (!request.url().endsWith('/api/session/call')) return;
    const body = request.postDataJSON();
    if (body.ns === 'storage' && body.method === 'set' && body.args.key === 'mini-notes:document:v1') writes++;
  });
  await page.goto(url); await dismissGuide(app);
  await composer.fill('saved fixture'); await save.click(); await expect(app.getByTestId('note-1')).toBeVisible();
  const draft = '多标签页中的草稿😀\n尚未保存'; await composer.fill(draft);
  phase = 'watch-update'; const navigationBeforeWatch = navigations;
  await appendFile(resolve(directory, 'bundle/index.html'), '\n<!-- independent watch smoke -->\n');
  await expect(page.locator('#frame')).toHaveAttribute('data-update-pending', 'true', { timeout: 10_000 });
  await expect(composer).toHaveValue(draft); assert.equal(navigations, navigationBeforeWatch);
  assert.equal(creates, 1); assert.equal(writes, 1);
  mark('real Host watch update preserves the existing editor');
  phase = 'two-tabs'; await other.goto(url); await dismissGuide(other.frameLocator('#app'));
  await page.bringToFront(); await composer.click();
  await expect(app.getByText('会话已失效', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue(draft); await expect(composer).toBeEditable();
  await expect(save).toBeDisabled(); await expect(app.getByRole('button', { name: 'Summarize', exact: true })).toBeDisabled();
  await expect(app.getByRole('button', { name: '删除笔记 1', exact: true })).toBeDisabled();
  assert.equal(creates, 2); assert.equal(writes, 1);
  mark('two tabs detect expiry without navigation or automatic writes');
  await recovery.click(); await dismissGuide(app);
  await expect(composer).toHaveValue(draft); await expect(save).toBeEnabled();
  await expect(app.getByTestId('note-1')).toHaveCount(0);
  assert.equal(creates, 3); assert.equal(writes, 1);
  await save.click(); await expect(app.getByTestId('note-1')).toContainText(draft);
  await expect(composer).toHaveValue(''); assert.equal(writes, 2);
  mark('manual new session restores draft and waits for explicit save');
  phase = 'recovered-tool-route';
  await app.getByRole('button', { name: 'Summarize', exact: true }).click();
  await expect(app.getByTestId('no-llm-notice')).toContainText('harness started with --no-llm', { timeout: 70_000 });
  mark('recovered SDK keeps the real Executa sampling route');
  phase = 'host-restart'; const restartDraft = 'Host 重启仍保留的草稿😀'; await composer.fill(restartDraft);
  await stopChildTree(host);
  await app.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(app.getByText('Anna 暂不可用', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(composer).toHaveValue(restartDraft); assert.equal(creates, 3);
  // A failed manual request must leave the original editor untouched.
  await recovery.click();
  await expect(recovery).toBeEnabled({ timeout: 20_000 });
  await expect(composer).toHaveValue(restartDraft);
  await startHost(); await recovery.click(); await dismissGuide(app);
  await expect(composer).toHaveValue(restartDraft); await expect(save).toBeEnabled();
  await expect(app.getByTestId('note-1')).toHaveCount(0); assert.equal(writes, 2);
  mark('Host restart and failed recovery preserve draft without replay');
  phase = 'unknown-write'; let dropped = false;
  await page.route('**/api/session/call', async route => {
    const body = route.request().postDataJSON();
    if (body.ns === 'storage' && body.args.key === 'mini-notes:document:v1') {
      if (body.method === 'set') { await route.fetch(); dropped = true; await route.abort(); return; }
      if (dropped && body.method === 'get') { await route.abort(); return; }
    }
    await route.continue();
  });
  await save.click();
  await expect(app.getByRole('status').filter({ hasText: '正在确认写入结果' })).toBeVisible();
  await expect(recovery).toBeDisabled(); await expect(composer).toHaveValue(restartDraft);
  const countAtUncertainty = creates;
  await other.reload(); await dismissGuide(other.frameLocator('#app'));
  await page.unroute('**/api/session/call');
  await page.bringToFront(); await app.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(app.getByText('会话已失效', { exact: true })).toBeVisible();
  await expect(recovery).toBeDisabled(); await expect(save).toBeDisabled();
  await expect(composer).toHaveValue(restartDraft); assert.equal(creates, countAtUncertainty + 1);
  mark('unknown committed write stays isolated even after session loss');
  result.passed = true;
} catch {
  // Assertions can contain private DOM or RPC payloads. Emit only a phase.
  result.failurePhase = phase;
  throw new Error(`Session recovery verification failed in phase ${phase}.`);
} finally {
  await browser?.close(); await preview?.close(); await stopChildTree(host);
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(result, null, 2));
  console.log(`Session recovery report: ${resolve(directory, 'report.json')}`);
}
