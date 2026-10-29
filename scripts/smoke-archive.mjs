import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { ROOT, run } from './lib.mjs';
import { TARGETS, detectHost, selectTarget, sha256 } from './package-native.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const checkedJSON = value => JSON.parse(value.toString('utf8'));

function nativeTarget(bytes) {
  if (bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    if (cpu === 0x0100000c) return 'darwin-arm64';
    if (cpu === 0x01000007) return 'darwin-x86_64';
  }
  if (bytes.length >= 0x40 && bytes.toString('ascii', 0, 2) === 'MZ') {
    const offset = bytes.readUInt32LE(0x3c);
    if (offset <= bytes.length - 6 && bytes.toString('ascii', offset, offset + 4) === 'PE\0\0' && bytes.readUInt16LE(offset + 4) === 0x8664) return 'windows-x86_64';
  }
  throw new Error('Archive entrypoint is not a supported native PE/Mach-O executable');
}

async function readEntries(archive) {
  if ((await stat(archive)).size > MAX_BYTES) throw new Error('Archive exceeds size limit');
  const entries = [];
  let total = 0;
  const collect = async (stream, entry) => {
    const parts = [];
    for await (const part of stream) {
      total += part.length;
      if (total > MAX_BYTES) throw new Error('Unpacked archive exceeds size limit');
      parts.push(part);
    }
    entries.push({ ...entry, bytes: Buffer.concat(parts) });
  };
  if (archive.endsWith('.zip')) {
    const zip = await new Promise((resolveZip, reject) => yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolveZip(value)));
    await new Promise((resolveZip, reject) => {
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', resolveZip);
      zip.on('entry', entry => {
        if (entry.uncompressedSize > MAX_BYTES) return fail(new Error('Unpacked archive exceeds size limit'));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const mode = entry.externalFileAttributes >>> 16;
          const type = entry.fileName.endsWith('/') ? 'Directory' : (mode & 0o170000) === 0o120000 ? 'SymbolicLink' : 'File';
          collect(stream, { path: entry.fileName, mode, type }).then(() => zip.readEntry(), fail);
        });
      });
      zip.readEntry();
    });
  } else if (archive.endsWith('.tar.gz')) {
    const pending = [];
    await tar.t({ file: archive, strict: true, noResume: true, onReadEntry(entry) {
      const task = collect(entry, { path: entry.path, mode: entry.mode, type: entry.type });
      task.catch(() => {});
      pending.push(task);
    } });
    await Promise.all(pending);
  } else throw new Error('Unsupported archive extension');
  return entries;
}

export async function inspectArchive(archive, expected = {}) {
  const entries = await readEntries(resolve(archive));
  const paths = new Set();
  for (const entry of entries) {
    if (!/^(?:manifest\.json|bin\/?|bin\/[a-z][a-z0-9-]*(?:\.exe)?)$/.test(entry.path)) throw new Error(`Unsafe or unexpected archive path: ${entry.path}`);
    if (paths.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}`);
    paths.add(entry.path);
    if (!['File', 'Directory'].includes(entry.type)) throw new Error(`Archive links/special files are forbidden: ${entry.path}`);
    if (entry.type === 'Directory' && !['bin', 'bin/'].includes(entry.path)) throw new Error('Only bin/ may be a directory');
  }
  const root = entries.find(entry => entry.path === 'manifest.json' && entry.type === 'File');
  if (!root) throw new Error('Missing archive root manifest.json');
  const manifest = checkedJSON(root.bytes);
  assert.match(manifest.name ?? '', /^[a-z][a-z0-9-]*$/, 'Invalid manifest identity');
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Invalid manifest version');
  if (expected.name) assert.equal(manifest.name, expected.name, 'Archive identity mismatch');
  if (expected.version) assert.equal(manifest.version, expected.version, 'Archive version mismatch');
  assert.equal(manifest.runtime?.type, 'binary');
  const entrypoint = manifest.runtime?.binary?.entrypoint;
  const binary = entries.find(entry => entry.path === entrypoint && entry.type === 'File');
  if (!binary) throw new Error('Archive manifest entrypoint does not exist');
  const target = nativeTarget(binary.bytes);
  if (expected.target) assert.equal(target, expected.target, 'Archive platform/binary architecture mismatch');
  const config = TARGETS[target];
  assert.equal(entrypoint, `bin/${manifest.name}${config.suffix}`, 'Invalid relative entrypoint');
  assert(archive.endsWith(`.${config.extension}`), 'Archive extension does not match target');
  const files = entries.filter(entry => entry.type === 'File').map(entry => entry.path);
  assert.deepEqual(files.slice().sort(), ['manifest.json', entrypoint].sort(), 'Archive must contain exactly its root manifest and binary');
  if (config.goos === 'darwin') {
    assert.equal(binary.mode & 0o777, 0o755, 'macOS executable tar mode must be 0755');
    assert.equal(manifest.runtime.binary.permissions?.[entrypoint], '0o755', 'macOS executable permission must be declared');
  }
  return { manifest, target, files, entries, binaryMode: binary.mode, binarySha256: sha256(binary.bytes) };
}

export async function extractArchive(archive, destination, expected = {}) {
  const inspected = await inspectArchive(archive, expected);
  await mkdir(destination, { recursive: false });
  for (const entry of inspected.entries.filter(entry => entry.type === 'File')) {
    const output = resolve(destination, entry.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, entry.bytes, { flag: 'wx' });
    await chmod(output, entry.path === inspected.manifest.runtime.binary.entrypoint ? 0o755 : 0o644);
  }
  return inspected;
}

export async function smokeArchive(archive) {
  const source = checkedJSON(await readFile(resolve(ROOT, 'executas/mini-notes-summarizer/manifest.json')));
  const target = selectTarget(detectHost());
  archive ??= resolve(ROOT, 'dist', `${source.name}-${source.version}-${target.key}.${target.extension}`);
  await mkdir(resolve(ROOT, '.tools'), { recursive: true });
  const work = await mkdtemp(resolve(ROOT, '.tools/archive-smoke-'));
  const inspected = await extractArchive(archive, resolve(work, 'unpacked'), { target: target.key, name: source.name, version: source.version });
  const executable = resolve(work, 'unpacked', inspected.manifest.runtime.binary.entrypoint);
  const transcript = resolve(work, 'protocol.jsonl'), report = resolve(work, 'protocol-report.json');
  await run(process.execPath, [resolve(ROOT, 'scripts/test-protocol.mjs'), '--executable', executable, '--transcript', transcript, '--report', report]);
  const result = checkedJSON(await readFile(report));
  assert.equal(result.passed, true);
  assert.equal(result.executable, executable);
  assert.equal(result.sha256, inspected.binarySha256, 'Smoke executed a different binary');
  const frames = (await readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const described = frames.find(frame => frame.direction === 'executa-to-host' && frame.message?.result?.name === source.name)?.message.result;
  assert(described, 'Missing binary describe response in transcript');
  for (const field of ['name', 'version', 'tools', 'host_capabilities']) assert.deepEqual(described[field], inspected.manifest[field], `Binary/archive ${field} mismatch`);
  await mkdir(resolve(ROOT, 'evidence'), { recursive: true });
  const recordedTranscript = resolve(ROOT, `evidence/archive-${target.key}-rpc.jsonl`);
  const recordedReport = resolve(ROOT, `evidence/archive-${target.key}-protocol-report.json`);
  await writeFile(recordedTranscript, await readFile(transcript));
  await writeFile(recordedReport, await readFile(report));
  const evidence = { passed: true, archive: resolve(archive), archiveSha256: sha256(await readFile(archive)), target: target.key, extractedDirectory: resolve(work, 'unpacked'), executable, binarySha256: inspected.binarySha256, transcript: recordedTranscript, protocolReport: recordedReport, checks: result.checks };
  await writeFile(resolve(ROOT, `evidence/archive-smoke-${target.key}.json`), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Archive smoke passed (${result.checks} protocol checks): ${executable}`);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length && (argv.length !== 2 || argv[0] !== '--archive')) throw new Error('Usage: smoke-archive.mjs [--archive <native-archive>]');
    await smokeArchive(argv[1] && resolve(argv[1]));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
