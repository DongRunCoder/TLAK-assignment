import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTagVersion, verifyReleaseFiles, assertDraftCommit } from '../../scripts/release.mjs';

test('release requires the existing tag version to equal the package version', () => {
  assert.equal(validateTagVersion('v0.1.0', '0.1.0'), '0.1.0');
  assert.throws(() => validateTagVersion('main', '0.1.0'), /tag/);
  assert.throws(() => validateTagVersion('v0.2.0', '0.1.0'), /version/);
});

test('public release verification rejects incomplete, modified, or wrong-commit assets', () => {
  const commit = 'a'.repeat(40);
  const assets = ['darwin-arm64', 'darwin-x86_64', 'windows-x86_64'].map(target => ({
    target, name: `mini-notes-summarizer-0.1.0-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`,
    size: 123, sha256: 'b'.repeat(64)
  }));
  const metadata = { schema: 1, tag: 'v0.1.0', sourceCommit: commit, tool: { name: 'mini-notes-summarizer', version: '0.1.0' }, assets };
  const sums = assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n';
  const actual = assets.map(asset => ({ ...asset }));
  const expected = { tag: 'v0.1.0', sourceCommit: commit, name: 'mini-notes-summarizer', version: '0.1.0' };
  assert.equal(verifyReleaseFiles(metadata, sums, actual, expected), true);
  assert.throws(() => verifyReleaseFiles(metadata, sums, actual.slice(1), expected), /asset/);
  assert.throws(() => verifyReleaseFiles(metadata, sums, [{ ...actual[0], sha256: 'c'.repeat(64) }, ...actual.slice(1)], expected), /checksum/);
  assert.throws(() => verifyReleaseFiles({ ...metadata, sourceCommit: 'd'.repeat(40) }, sums, actual, expected), /commit/);
  assert.throws(() => verifyReleaseFiles(metadata, sums.replace(/b/g, 'c'), actual, expected), /checksum/);
  assert.throws(() => verifyReleaseFiles(metadata, sums + sums.split('\n')[0] + '\n', actual, expected), /Duplicate/);
});

test('only a same-commit draft may be replaced; public assets are immutable', () => {
  const commit = 'a'.repeat(40);
  assert.doesNotThrow(() => assertDraftCommit({ draft: true, target_commitish: commit }, commit));
  assert.throws(() => assertDraftCommit({ draft: false, target_commitish: commit }, commit), /public/);
  assert.throws(() => assertDraftCommit({ draft: true, target_commitish: 'b'.repeat(40) }, commit), /commit/);
});
