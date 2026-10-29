import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';
import { TARGETS, capture, sha256 } from './package-native.mjs';
import { inspectArchive } from './smoke-archive.mjs';

export function validateTagVersion(tag, version) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error('Release tag must be an existing v<semver> tag');
  if (tag !== `v${version}`) throw new Error(`Release tag/package version mismatch: ${tag} versus ${version}`);
  return version;
}

export function assetSpecs(name, version) {
  return Object.values(TARGETS).map(target => ({ target: target.key, name: `${name}-${version}-${target.key}.${target.extension}` }));
}

export function verifyReleaseFiles(metadata, sums, actual, expected) {
  assert.equal(metadata.schema, 1, 'Unsupported release metadata');
  assert.equal(metadata.tag, expected.tag, 'Release metadata tag mismatch');
  assert.equal(metadata.sourceCommit, expected.sourceCommit, 'Release metadata source commit mismatch');
  assert.equal(metadata.tool?.name, expected.name, 'Release tool identity mismatch');
  assert.equal(metadata.tool?.version, expected.version, 'Release tool version mismatch');
  const required = assetSpecs(expected.name, expected.version);
  assert.equal(metadata.assets?.length, required.length, 'Incomplete metadata asset set');
  assert.equal(actual.length, required.length, 'Incomplete downloaded asset set');
  const checksums = new Map();
  for (const line of sums.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}([^\s/\\]+)$/.exec(line);
    assert(match, 'Invalid checksum line');
    assert(!checksums.has(match[2]), 'Duplicate checksum entry');
    checksums.set(match[2], match[1]);
  }
  assert.equal(checksums.size, required.length, 'Incomplete checksum asset set');
  for (const spec of required) {
    const declared = metadata.assets.filter(asset => asset.name === spec.name);
    const downloaded = actual.filter(asset => asset.name === spec.name);
    assert.equal(declared.length, 1, `Missing/duplicate metadata asset ${spec.name}`);
    assert.equal(downloaded.length, 1, `Missing/duplicate downloaded asset ${spec.name}`);
    const record = declared[0], file = downloaded[0];
    assert.equal(record.target, spec.target, 'Asset platform mismatch');
    assert.equal(record.size, file.size, `Asset size mismatch: ${spec.name}`);
    assert.equal(record.sha256, file.sha256, `Asset checksum mismatch: ${spec.name}`);
    assert.equal(checksums.get(spec.name), file.sha256, `SHA256SUMS checksum mismatch: ${spec.name}`);
    if (record.binarySha256) assert.equal(record.binarySha256, file.binarySha256, 'Entrypoint checksum mismatch');
  }
  return true;
}

export function assertDraftCommit(release, commit) {
  assert.equal(release.draft, true, 'Refusing to overwrite a public Release');
  assert.equal(release.target_commitish, commit, 'Draft source commit differs; refusing replacement');
}

function client() {
  const repository = process.env.GITHUB_REPOSITORY;
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''), 'GITHUB_REPOSITORY is required');
  assert(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN is required');
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const base = `${api}/repos/${repository}`;
  async function request(url, { method = 'GET', body, binary = false, allow404 = false, contentType } = {}) {
    const response = await fetch(url.startsWith('https://') ? url : `${base}${url}`, {
      method, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': contentType ?? 'application/json' } : {}) },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 404 && allow404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} failed (${response.status}): ${await response.text()}`);
    if (response.status === 204) return null;
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  return { request, repository };
}

async function remoteTagCommit(api, tag) {
  let object = (await api.request(`/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = (await api.request(`/git/tags/${object.sha}`)).object;
  assert.equal(object.type, 'commit', 'Tag does not resolve to a commit');
  return object.sha;
}

async function configuration(tag) {
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  const tool = JSON.parse(await readFile(resolve(ROOT, 'executas/mini-notes-summarizer/manifest.json'), 'utf8'));
  validateTagVersion(tag, pkg.version);
  assert.equal(pkg.version, tool.version, 'Tool/package version mismatch');
  const sourceCommit = capture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  assert.equal(capture('git', ['rev-parse', 'HEAD']), sourceCommit, 'Checkout is not the release tag commit');
  return { tag, sourceCommit, name: tool.name, version: tool.version };
}

async function releaseAssets(api, release) {
  const assets = await api.request(`/releases/${release.id}/assets?per_page=100`);
  assert(assets.length < 100, 'Unexpectedly large Release asset set');
  return assets;
}

async function verifyRemoteRelease(api, release, expected) {
  assert.equal(release.tag_name, expected.tag);
  const assets = await releaseAssets(api, release);
  const names = [...assetSpecs(expected.name, expected.version).map(item => item.name), 'SHA256SUMS', 'release-metadata.json'];
  assert.deepEqual(assets.map(asset => asset.name).sort(), names.sort(), 'Release asset set is incomplete or unexpected');
  const downloaded = new Map();
  for (const asset of assets) {
    assert.equal(asset.state, 'uploaded', `Release asset not uploaded: ${asset.name}`);
    assert(asset.size > 0 && asset.size <= 64 * 1024 * 1024, 'Invalid Release asset size');
    const bytes = await api.request(`/releases/assets/${asset.id}`, { binary: true });
    assert.equal(bytes.length, asset.size, `Downloaded size mismatch: ${asset.name}`);
    if (asset.digest) assert.equal(asset.digest, `sha256:${sha256(bytes)}`, `Server asset checksum mismatch: ${asset.name}`);
    downloaded.set(asset.name, bytes);
  }
  await mkdir(resolve(ROOT, '.tools'), { recursive: true });
  const work = await mkdtemp(resolve(ROOT, '.tools/release-verification-'));
  const actual = [];
  for (const spec of assetSpecs(expected.name, expected.version)) {
    const bytes = downloaded.get(spec.name), file = resolve(work, spec.name);
    await writeFile(file, bytes);
    const inspected = await inspectArchive(file, { name: expected.name, version: expected.version, target: spec.target });
    actual.push({ ...spec, size: bytes.length, sha256: sha256(bytes), binarySha256: inspected.binarySha256 });
  }
  verifyReleaseFiles(JSON.parse(downloaded.get('release-metadata.json')), downloaded.get('SHA256SUMS').toString('utf8'), actual, expected);
  return true;
}

async function prepare(tag) {
  const expected = await configuration(tag), api = client();
  assert.equal(await remoteTagCommit(api, tag), expected.sourceCommit, 'Remote tag source commit mismatch');
  const release = await api.request(`/releases/tags/${encodeURIComponent(tag)}`, { allow404: true });
  let skip = false;
  if (release && !release.draft) {
    await verifyRemoteRelease(api, release, expected);
    skip = true;
    console.log(`Public Release ${tag} already exists and all assets verified; skipping build/publish.`);
  } else if (release) assertDraftCommit(release, expected.sourceCommit);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\nsource-commit=${expected.sourceCommit}\nskip=${skip}\n`);
  console.log(JSON.stringify({ ...expected, skip }));
}

async function collectBuilds(directory, expected) {
  const assets = [];
  for (const spec of assetSpecs(expected.name, expected.version)) {
    const file = resolve(directory, spec.name), bytes = await readFile(file);
    const build = JSON.parse(await readFile(`${file}.metadata.json`, 'utf8'));
    assert.equal(build.target, spec.target, 'Build target mismatch');
    assert.equal(build.sourceCommit, expected.sourceCommit, 'Build source commit mismatch');
    assert.equal(build.version, expected.version, 'Build version mismatch');
    assert.equal(build.name, expected.name, 'Build identity mismatch');
    assert.equal(build.archive.name, spec.name);
    assert.equal(build.archive.sha256, sha256(bytes), 'Build archive checksum mismatch');
    assert.equal(build.archive.size, bytes.length);
    const inspected = await inspectArchive(file, { name: expected.name, version: expected.version, target: spec.target });
    assert.equal(build.binary.sha256, inspected.binarySha256, 'Build binary checksum mismatch');
    assets.push({ ...spec, size: bytes.length, sha256: sha256(bytes), binarySha256: inspected.binarySha256, toolchain: build.toolchain });
  }
  const metadata = { schema: 1, tag: expected.tag, sourceCommit: expected.sourceCommit, tool: { name: expected.name, version: expected.version },
    runUrl: `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, createdAt: new Date().toISOString(), assets };
  const sums = assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n';
  verifyReleaseFiles(metadata, sums, assets, expected);
  await writeFile(resolve(directory, 'SHA256SUMS'), sums);
  await writeFile(resolve(directory, 'release-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return [...assets.map(asset => asset.name), 'SHA256SUMS', 'release-metadata.json'];
}

async function publish(tag, directory) {
  const expected = await configuration(tag), api = client();
  assert.equal(await remoteTagCommit(api, tag), expected.sourceCommit, 'Remote tag moved before publish');
  let release = await api.request(`/releases/tags/${encodeURIComponent(tag)}`, { allow404: true });
  if (release && !release.draft) {
    await verifyRemoteRelease(api, release, expected);
    console.log(`Public Release ${tag} already verified; unchanged.`);
    return;
  }
  const names = await collectBuilds(directory, expected);
  if (release) {
    assertDraftCommit(release, expected.sourceCommit);
    for (const asset of await releaseAssets(api, release)) await api.request(`/releases/assets/${asset.id}`, { method: 'DELETE' });
  } else release = await api.request('/releases', { method: 'POST', body: { tag_name: tag, target_commitish: expected.sourceCommit, name: tag, draft: true, prerelease: expected.version.includes('-'), body: `Mini Notes Summarizer ${expected.version}\n\nSource commit: ${expected.sourceCommit}\n\nNative archives contain a root manifest and a standalone Go executable. Checksums and build metadata are attached.` } });
  assertDraftCommit(release, expected.sourceCommit);
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name));
    await api.request(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes, contentType: name.endsWith('.zip') ? 'application/zip' : name.endsWith('.tar.gz') ? 'application/gzip' : name.endsWith('.json') ? 'application/json' : 'text/plain' });
  }
  const draft = await api.request(`/releases/${release.id}`);
  assertDraftCommit(draft, expected.sourceCommit);
  await verifyRemoteRelease(api, draft, expected);
  assert.equal(await remoteTagCommit(api, tag), expected.sourceCommit, 'Remote tag moved during upload');
  const published = await api.request(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false } });
  assert.equal(published.draft, false);
  await verifyRemoteRelease(api, published, expected);
  console.log(`Published and verified ${published.html_url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, tag, directory = 'dist', ...rest] = process.argv.slice(2);
    assert(!rest.length && ['prepare', 'publish'].includes(command) && tag, 'Usage: release.mjs <prepare|publish> <existing-vtag> [artifact-directory]');
    if (command === 'prepare') await prepare(tag);
    else await publish(tag, resolve(directory));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
