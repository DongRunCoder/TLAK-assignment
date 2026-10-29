import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../../scripts/lib.mjs';
import { selectTarget, archiveManifest, createArchive } from '../../scripts/package-native.mjs';
import { inspectArchive, extractArchive } from '../../scripts/smoke-archive.mjs';

await mkdir(resolve(ROOT, '.tools'), { recursive: true });
const work = await mkdtemp(resolve(ROOT, '.tools/packaging-test-'));
after(() => rm(work, { recursive: true, force: true }));
const source = JSON.parse(await readFile(resolve(ROOT, 'executas/mini-notes-summarizer/manifest.json'), 'utf8'));
const host = { gohostos: 'windows', gohostarch: 'amd64', goos: 'windows', goarch: 'amd64', platform: 'win32', arch: 'x64', systemArch: 'x64', runnerArch: 'X64' };

test('host selection maps Go amd64 to Anna x86_64 and requires an explicit cross target', () => {
  assert.equal(selectTarget(host).key, 'windows-x86_64');
  assert.throws(() => selectTarget({ ...host, goos: 'darwin' }), /GOOS\/GOARCH/);
  assert.throws(() => selectTarget({ ...host, systemArch: 'arm64' }), /architecture/);
  assert.throws(() => selectTarget({ ...host, runnerArch: 'ARM64' }), /architecture/);
  assert.throws(() => selectTarget({ ...host, gohostos: 'linux', goos: 'linux', platform: 'linux' }), /Unsupported/);
  assert.equal(selectTarget({ ...host, systemArch: 'arm64' }, 'darwin-arm64').key, 'darwin-arm64');
  assert.throws(() => selectTarget(host, 'linux-x86_64'), /Unsupported target/);
});

for (const target of ['windows-x86_64', 'darwin-arm64', 'darwin-x86_64']) {
  test(`${target} has a root manifest, matching relative entrypoint, and native file mode`, async () => {
    const config = selectTarget(host, target);
    const manifest = archiveManifest(source, config);
    assert.equal(manifest.runtime.binary.entrypoint, `bin/mini-notes-summarizer${target.startsWith('windows') ? '.exe' : ''}`);
    const stage = resolve(work, target);
    await mkdir(resolve(stage, 'bin'), { recursive: true });
    const binary = Buffer.alloc(256);
    if (target.startsWith('windows')) {
      binary.write('MZ'); binary.writeUInt32LE(0x80, 0x3c); binary.write('PE\0\0', 0x80); binary.writeUInt16LE(0x8664, 0x84);
    } else {
      binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(target === 'darwin-arm64' ? 0x0100000c : 0x01000007, 4);
    }
    await writeFile(resolve(stage, manifest.runtime.binary.entrypoint), binary);
    await writeFile(resolve(stage, 'manifest.json'), JSON.stringify(manifest));
    const archive = resolve(work, `mini-notes-summarizer-${source.version}-${target}.${config.extension}`);
    await createArchive(stage, archive, config);
    const result = await inspectArchive(archive, { target, name: source.name, version: source.version });
    assert.deepEqual(result.files.sort(), ['manifest.json', manifest.runtime.binary.entrypoint].sort());
    if (target.startsWith('darwin')) assert.equal(result.binaryMode & 0o777, 0o755);
    const destination = resolve(work, `extracted-${target}`);
    await extractArchive(archive, destination, { target, name: source.name, version: source.version });
    assert.deepEqual(await readFile(resolve(destination, manifest.runtime.binary.entrypoint)), binary);
    await assert.rejects(inspectArchive(archive, { target, name: source.name, version: '99.0.0' }), /version/);
  });
}

test('archive manifest refuses an unsafe identity and a source version mismatch', () => {
  const config = selectTarget(host);
  assert.throws(() => archiveManifest({ ...source, name: '../escape' }, config), /identity/);
  assert.throws(() => archiveManifest(source, config, '99.0.0'), /version/);
});
