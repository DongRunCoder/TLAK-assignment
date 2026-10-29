import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ROOT as root, environment, goPath, run } from './lib.mjs';
import { host, request } from '../tests/protocol/host.mjs';

const argv = process.argv.slice(2);
function option(name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error(`${name} needs a value`);
  return argv[index + 1];
}
const executable = option('--executable');
const command = executable ? resolve(executable) : resolve(root, '.tools/protocol', `mini-notes-summarizer${process.platform === 'win32' ? '.exe' : ''}`);
if (!executable) {
  await mkdir(dirname(command), { recursive: true });
  await run(goPath(), ['build', '-trimpath', '-o', command, '.'], { cwd: resolve(root, 'executas/mini-notes-summarizer') });
}
const sha256 = createHash('sha256').update(await readFile(command)).digest('hex');
const transcriptPath = resolve(option('--transcript') ?? resolve(root, 'evidence/protocol.jsonl'));
const reportPath = resolve(option('--report') ?? resolve(root, 'evidence/protocol-report.json'));
const startedAt = new Date().toISOString();
const processHost = host(command, [], {
  cwd: resolve(root, 'executas/mini-notes-summarizer'),
  env: environment()
});
let passed = 0;
let succeeded = false;
try {
  processHost.send(request(1, 'initialize', { protocolVersion: '2.0', capabilities: { sampling: {} } }));
  const initialized = (await processHost.receive(frame => frame.id === 1, 60000)).message;
  assert.equal(initialized.result.protocolVersion, '2.0');
  assert.deepEqual(initialized.result.client_capabilities.sampling, {});
  assert.deepEqual(initialized.result.capabilities.sampling, {});
  passed++;
  processHost.sendRaw('{"jsonrpc":"2.0","id":9007199254740993,"method":"describe"}');
  const described = await processHost.receive(frame => frame.result?.name === 'mini-notes-summarizer');
  assert.match(described.raw, /"id":9007199254740993(?:,|})/);
  assert.equal(described.message.result.manifest, undefined);
  assert.deepEqual(described.message.result.host_capabilities, ['llm.sample']);
  passed++;
  processHost.send(request('invoke-one', 'invoke', { tool: 'summarize', arguments: { notes: ['明天联系客户', '修复登录问题'] }, context: { invoke_id: 'protocol-invoke-1' } }));
  const reverse = (await processHost.receive(frame => frame.method === 'sampling/createMessage')).message;
  assert.equal(reverse.params.context.invoke_id, 'protocol-invoke-1');
  assert.equal(reverse.params.metadata.executa_invoke_id, 'protocol-invoke-1');
  assert.deepEqual(JSON.parse(reverse.params.messages[0].content.text), ['明天联系客户', '修复登录问题']);
  processHost.send(request('health-while-sampling', 'health'));
  assert.equal((await processHost.receive(frame => frame.id === 'health-while-sampling')).message.result.status, 'ready');
  processHost.send(request('busy', 'invoke', { tool: 'summarize', arguments: { notes: ['another'] }, context: { invoke_id: 'must-not-leak' } }));
  assert.match((await processHost.receive(frame => frame.id === 'busy')).message.result.error, /^TOOL_BUSY:/);
  const fixture = JSON.parse((await readFile(resolve(root, 'fixtures/sampling/success.jsonl'), 'utf8')).trim());
  assert.equal(fixture.ns, 'sampling');
  assert.equal(fixture.method, 'createMessage');
  processHost.send({ jsonrpc: '2.0', id: reverse.id, result: fixture.result });
  const summarized = (await processHost.receive(frame => frame.id === 'invoke-one')).message;
  assert.equal(summarized.result.success, true);
  assert.equal(summarized.result.data.summary, fixture.result.content.text);
  assert.equal(summarized.result.data.truncated, false);
  passed++;
  processHost.send(request(0, 'describe'));
  assert.equal((await processHost.receive(frame => frame.id === 0)).message.result.name, 'mini-notes-summarizer');
  processHost.send(request('0', 'describe'));
  assert.equal((await processHost.receive(frame => frame.id === '0')).message.result.name, 'mini-notes-summarizer');
  processHost.send(request(null, 'describe'));
  assert.equal((await processHost.receive(frame => frame.id === null)).message.result.name, 'mini-notes-summarizer');
  passed++;
  processHost.send(request('after-first', 'invoke', { tool: 'summarize', arguments: { notes: ['third'] }, context: { invoke_id: 'protocol-invoke-2' } }));
  const second = (await processHost.receive(frame => frame.method === 'sampling/createMessage')).message;
  assert.equal(second.params.context.invoke_id, 'protocol-invoke-2');
  processHost.send({ jsonrpc: '2.0', id: second.id, result: { content: { type: 'text', text: '  host exact text\n' }, stopReason: 'maxTokens' } });
  const truncated = (await processHost.receive(frame => frame.id === 'after-first')).message.result.data;
  assert.equal(truncated.summary, '  host exact text\n');
  assert.equal(truncated.truncated, true);
  passed++;
  const localInvokeIDs = new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    processHost.send(request('runner-reused-request-id', 'invoke', { tool: 'summarize', arguments: { notes: ['standalone runner has no context'] } }));
    const localFrame = (await processHost.receive(frame => frame.method === 'sampling/createMessage' || frame.id === 'runner-reused-request-id')).message;
    assert.equal(localFrame.method, 'sampling/createMessage', `runner invoke must sample: ${JSON.stringify(localFrame)}`);
    const localID = localFrame.params.context.invoke_id;
    assert.equal(typeof localID, 'string');
    assert.ok(localID.length > 0);
    assert.notEqual(localID, 'runner-reused-request-id');
    assert.notEqual(localID, localFrame.id);
    assert.equal(localFrame.params.metadata.executa_invoke_id, localID);
    assert.ok(!localInvokeIDs.has(localID), 'each context-free invoke needs a fresh correlation ID');
    localInvokeIDs.add(localID);
    assert.deepEqual(JSON.parse(localFrame.params.messages[0].content.text), ['standalone runner has no context']);
    processHost.send({ jsonrpc: '2.0', id: localFrame.id, result: fixture.result });
    const completed = (await processHost.receive(frame => frame.id === 'runner-reused-request-id')).message.result;
    assert.equal(completed.success, true);
    assert.equal(completed.data.summary, fixture.result.content.text);
  }
  passed++;
  processHost.send(request('top-level-correlation', 'invoke', { tool: 'summarize', arguments: { notes: ['top-level invoke identity'] }, invoke_id: ' host top-level id ' }));
  const topLevel = (await processHost.receive(frame => frame.method === 'sampling/createMessage')).message;
  assert.equal(topLevel.params.context.invoke_id, ' host top-level id ');
  assert.equal(topLevel.params.metadata.executa_invoke_id, ' host top-level id ');
  processHost.send({ jsonrpc: '2.0', id: topLevel.id, result: fixture.result });
  assert.equal((await processHost.receive(frame => frame.id === 'top-level-correlation')).message.result.success, true);
  passed++;
  const invalidRequests = [
    ['{invalid JSON}', -32700],
    ['[]', -32600],
    ['{}', -32600],
    ['{"jsonrpc":"2.0","id":"missing-method"}', -32600],
    [JSON.stringify(request('missing-tool', 'invoke', { tool: 'unknown' })), -32601],
    [JSON.stringify(request('bad-notes', 'invoke', { tool: 'summarize', arguments: { notes: ['\ufeff'] }, context: { invoke_id: 'invalid' } })), -32602],
    [JSON.stringify(request('unknown-method', 'not-a-method')), -32601]
  ];
  for (const [raw, code] of invalidRequests) {
    processHost.sendRaw(raw);
    assert.equal((await processHost.receive(frame => frame.error !== undefined)).message.error.code, code);
  }
  passed++;
  for (const [index, response, expected] of [
    ['host-error', { error: { code: -32603, message: 'harness started with --no-llm' } }, 'SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm'],
    ['empty', { result: { content: { type: 'text', text: '\n\ufeff' } } }, 'SAMPLING_INVALID_RESPONSE:'],
    ['image', { result: { content: { type: 'image', text: 'must not become summary' } } }, 'SAMPLING_INVALID_RESPONSE:']
  ]) {
    processHost.send(request(index, 'invoke', { tool: 'summarize', arguments: { notes: ['host errors are real'] }, context: { invoke_id: index } }));
    const sampling = (await processHost.receive(frame => frame.method === 'sampling/createMessage')).message;
    processHost.send({ jsonrpc: '2.0', id: 'unknown-reverse-id', result: { content: { type: 'text', text: 'ignore me' } } });
    processHost.send({ jsonrpc: '2.0', id: sampling.id, ...response });
    const failed = (await processHost.receive(frame => frame.id === index)).message.result;
    assert.equal(failed.success, false);
    assert.ok(failed.error.startsWith(expected), failed.error);
    processHost.send({ jsonrpc: '2.0', id: sampling.id, result: { content: { type: 'text', text: 'duplicate must be ignored' } } });
  }
  passed++;
  processHost.send(request('v1', 'initialize', { protocolVersion: '1.0' }));
  assert.equal((await processHost.receive(frame => frame.id === 'v1')).message.result.protocolVersion, '1.0');
  processHost.send(request('no-v1-sampling', 'invoke', { tool: 'summarize', arguments: { notes: ['v1'] }, context: { invoke_id: 'v1-invoke' } }));
  assert.match((await processHost.receive(frame => frame.id === 'no-v1-sampling')).message.result.error, /^SAMPLING_UNAVAILABLE:/);
  passed++;
  const beforeFinal = processHost.frames.length;
  processHost.send({ jsonrpc: '2.0', method: 'describe' });
  processHost.send(request('final-describe', 'describe'));
  processHost.child.stdin.end();
  assert.equal((await processHost.receive(frame => frame.id === 'final-describe')).message.result.name, 'mini-notes-summarizer');
  passed++;
  await processHost.stop();
  assert.equal((await processHost.closed).code, 0, processHost.stderr);
  const finalOutput = processHost.frames.slice(beforeFinal).filter(frame => frame.direction === 'executa-to-host');
  assert.equal(finalOutput.length, 1, 'notification must not receive a response');
  assert.equal(finalOutput[0].message.id, 'final-describe');
  assert.equal(passed, 11);
  succeeded = true;
} finally {
  try { await processHost.stop(); } finally {
    await processHost.save(transcriptPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ passed: succeeded, checks: passed, executable: command, sha256, transcript: transcriptPath, startedAt, completedAt: new Date().toISOString() }, null, 2) + '\n');
  }
}
console.log(`Protocol checks passed: ${passed} (v2, raw IDs, bidirectional sampling, busy, repeat, local correlation, host correlation, truncation, errors, v1, EOF)`);
