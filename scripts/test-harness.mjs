import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from './lib.mjs';
import { redactEvidence } from './redact-evidence.mjs';

// This drives the actual Anna dashboard/iframe. There is no Host API mock here.
const p0 = process.argv.includes('--p0');
const url = process.env.HARNESS_URL ?? 'http://127.0.0.1:5180/';
const NOTES_KEY = 'mini-notes:document:v1';
const GUIDE_KEY = 'mini-notes:onboarding:v1';
const NO_LLM_ERROR = 'SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm';
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const rpc = [], consoleErrors = [], httpErrors = [], hostWarnings = [];
const responses = [], responseErrors = [];
let liveSdkHash;
let phase = 'load', toolRequestsStarted = 0, toolResponsesFinished = 0, toolStartedAt, toolElapsedMs;
page.on('request', request => {
  if (!request.url().endsWith('/api/session/call')) return;
  const body = request.postDataJSON();
  if (body.ns === 'tools' && body.method === 'invoke') { toolRequestsStarted++; toolStartedAt = Date.now(); }
});
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
    // Keep real values only in memory for assertions. Project to public evidence
    // immediately before serialization; never capture the session envelope.
    const row = { sequence: rpc.length + 1, ns: request.ns, method: request.method, args: request.args };
    rpc.push(row);
    row.response = await response.json();
    if (row.ns === 'tools' && row.method === 'invoke') {
      toolResponsesFinished++; toolElapsedMs = Date.now() - toolStartedAt;
    }
  })();
  responses.push(pending.catch(error => responseErrors.push(String(error))));
});
await mkdir(resolve(ROOT, 'evidence'), { recursive: true });
const app = page.frameLocator('#app');
const privateText = app.locator('.note-content, textarea, .summary-text, [role="alert"]');
const evidenceName = p0 ? 'p0' : 'ui';
const report = passed => ({ url, sourceTest: 'scripts/test-harness.mjs', reproduce: 'npm run verify:harness',
  browser: 'Playwright; Browser plugin not available', actualAnnaHarness: true, passed,
  consoleErrors, httpErrors, hostWarnings, responseErrors, rpcCount: rpc.length, liveSdkHash });
const publicReport = passed => ({ ...redactEvidence(report(passed)), diagnostics: { phase, toolRequestsStarted, toolResponsesFinished, toolElapsedMs } });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await app.getByRole('heading', { name: 'Mini Notes', exact: true }).waitFor();
  await expect(page).toHaveTitle(/Anna|Harness/);
  phase = 'guide';
  const guide = app.getByRole('dialog', { name: '开始使用 Mini Notes', exact: true });
  await guide.waitFor();
  await guide.getByRole('button', { name: '开始使用（无需配置模型）', exact: true }).click();
  await guide.waitFor({ state: 'hidden' });
  await app.getByRole('button', { name: '使用说明', exact: true }).click();
  await guide.waitFor();
  await guide.press('Escape');
  await guide.waitFor({ state: 'hidden' });
  if (p0) {
    await app.getByRole('button', { name: '验证平台契约' }).click();
    await app.getByTestId('p0-result').filter({ hasText: 'P0 storage verified' }).waitFor();
    await app.getByRole('button', { name: '验证工具路由' }).click();
    await app.getByTestId('p0-tool-result').filter({ hasText: /harness started with --no-llm/ }).waitFor();
  } else {
    phase = 'notes';
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
    phase = 'summary';
    await app.getByRole('button', { name: 'Summarize', exact: true }).click();
    const noLlmNotice = app.getByTestId('no-llm-notice');
    // A fresh Windows runner may compile Go on first invoke. Match the SDK's
    // 65s tool budget rather than Playwright expect's unrelated 5s default.
    await expect(noLlmNotice).toBeVisible({ timeout: 70_000 });
    await expect(noLlmNotice).toContainText(NO_LLM_ERROR);
    await expect(noLlmNotice).toContainText('npm run test:sampling');
    await expect(app.getByTestId('summary-text')).toHaveCount(0);
    await expect(app.getByRole('button', { name: 'Summarize', exact: true })).toBeEnabled();
  }
  await Promise.all(responses);
  phase = 'rpc';
  assert.deepEqual(responseErrors, []);
  const localSdkHash = createHash('sha256').update(await readFile(resolve(ROOT, 'node_modules/@anna-ai/app-runtime/dist/index.js'))).digest('hex');
  assert.equal(liveSdkHash, localSdkHash, 'actual harness SDK must match locked npm file');
  const storage = rpc.filter(row => row.ns === 'storage');
  const guideReads = storage.filter(row => row.method === 'get' && row.args.key === GUIDE_KEY);
  const guideWrites = storage.filter(row => row.method === 'set' && row.args.key === GUIDE_KEY);
  assert(guideReads.length > 0, 'guide must read its independent preference key');
  assert.equal(guideReads[0].response.result.value, null, 'fresh guide preference must be absent');
  assert.equal(guideWrites.length, 1, 'reopening help must not rewrite the guide preference');
  assert.deepEqual(guideWrites[0].args.value, { schemaVersion: 1, seenGuideVersion: 1 });
  assert.equal(guideWrites[0].response.ok, true);
  const noteReads = storage.filter(row => row.method === 'get' && row.args.key === NOTES_KEY);
  const noteWrites = storage.filter(row => row.method === 'set' && row.args.key === NOTES_KEY);
  assert(noteReads.length > 0, 'notes must read their own document key');
  if (!p0) {
    assert(noteReads.length >= 2, 'reread must call notes storage.get');
    assert.equal(noteWrites.length, 4, 'only the four CRUD actions may write the notes key');
    assert.deepEqual(noteWrites.map(row => row.args.value.notes.map(note => [note.sequence, note.content])), [
      [[1, '明天联系客户']],
      [[1, '明天联系客户'], [2, '修复登录 bug']],
      [[2, '修复登录 bug']],
      [[2, '修复登录 bug'], [3, '整理 Workshop 想法']],
    ]);
    const expected = noteWrites.at(-1).args.value;
    assert.equal(expected.schemaVersion, 1);
    assert.equal(expected.nextSequence, 4);
    assert.equal(Object.hasOwn(expected, 'seenGuideVersion'), false, 'guide marker must never enter the notes document');
    assert.deepEqual(noteReads.at(-1).response.result.value, expected, 'explicit reread must return the persisted notes document');
    assert(noteWrites.every(row => row.response.ok === true && row.response.result.ok === true));
    assert(storage.every(row => [NOTES_KEY, GUIDE_KEY].includes(row.args.key)), 'notes and guide use only their own keys');
  }
  const tool = rpc.findLast(row => row.ns === 'tools' && row.method === 'invoke');
  assert(tool); assert.equal(tool.args.tool_id, 'mini-notes-summarizer');
  assert.equal(tool.args.method, 'summarize');
  if (!p0) assert.deepEqual(tool.args.args.notes, ['修复登录 bug', '整理 Workshop 想法']);
  assert.equal(rpc.filter(row => row.ns === 'llm').length, 0, 'iframe must never call llm directly');
  await writeFile(resolve(ROOT, `evidence/${evidenceName}-host-rpc.jsonl`), redactEvidence(rpc).map(row => JSON.stringify(row)).join('\n') + '\n');
  phase = 'screenshots';
  await app.locator('body').evaluate(body => body.ownerDocument.defaultView.scrollTo(0, 0));
  await page.locator('#app').screenshot({ path: resolve(ROOT, `evidence/${evidenceName}-harness.png`), mask: [privateText] });
  if (!p0) {
    await page.locator('#app').evaluate(frame => { frame.style.width = '360px'; frame.style.maxWidth = '360px'; });
    await expect.poll(() => app.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
    await page.locator('#app').screenshot({ path: resolve(ROOT, 'evidence/ui-harness-narrow.png'), mask: [privateText] });
  }
  assert.equal(consoleErrors.length, 0, 'App console must not emit errors');
  phase = 'complete';
  await writeFile(resolve(ROOT, `evidence/${evidenceName}-harness-report.json`), JSON.stringify(publicReport(true), null, 2));
  console.log(`${evidenceName} actual Anna iframe/storage/tools wiring: PASS (${rpc.length} Host calls)`);
} catch (error) {
  await page.locator('#app').screenshot({ path: resolve(ROOT, 'evidence/ui-failure.png'), mask: [privateText], timeout: 3000 }).catch(() => {});
  await Promise.all(responses);
  await writeFile(resolve(ROOT, `evidence/${evidenceName}-harness-report.json`),
    JSON.stringify({ ...publicReport(false), error: { message: '[REDACTED]' } }, null, 2));
  await writeFile(resolve(ROOT, `evidence/${evidenceName}-host-rpc.jsonl`),
    redactEvidence(rpc).map(row => JSON.stringify(row)).join('\n') + '\n');
  // Playwright and assertion errors can embed private DOM/RPC values. Do not
  // rethrow their messages or causes into terminal/CI logs.
  throw new Error('Actual Anna harness verification failed; inspect the redacted evidence and rerun npm run verify:harness.');
} finally { await Promise.all(responses); await browser.close(); }
