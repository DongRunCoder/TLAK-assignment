import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { machine } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import yazl from 'yazl';
import { ROOT, environment, goPath, run } from './lib.mjs';

export const TARGETS = Object.freeze({
  'darwin-arm64': { key: 'darwin-arm64', goos: 'darwin', goarch: 'arm64', extension: 'tar.gz', suffix: '' },
  'darwin-x86_64': { key: 'darwin-x86_64', goos: 'darwin', goarch: 'amd64', extension: 'tar.gz', suffix: '' },
  'windows-x86_64': { key: 'windows-x86_64', goos: 'windows', goarch: 'amd64', extension: 'zip', suffix: '.exe' },
});
const normalizedArch = value => ({ amd64: 'x64', x86_64: 'x64', x64: 'x64', aarch64: 'arm64', arm64: 'arm64' })[value?.toLowerCase()];

export function selectTarget(host, explicitTarget) {
  if (explicitTarget) {
    if (!TARGETS[explicitTarget]) throw new Error(`Unsupported target ${explicitTarget}; supported: ${Object.keys(TARGETS).join(', ')}`);
    return TARGETS[explicitTarget];
  }
  if (host.goos !== host.gohostos || host.goarch !== host.gohostarch) throw new Error('Inherited GOOS/GOARCH do not match GOHOSTOS/GOHOSTARCH. Remove overrides or use --target for cross compilation.');
  const expectedOS = host.platform === 'win32' ? 'windows' : host.platform;
  if (expectedOS !== host.gohostos) throw new Error('Go host OS differs from the running system; use an explicit --target.');
  const goArch = normalizedArch(host.gohostarch);
  for (const value of [host.arch, host.systemArch, host.runnerArch].filter(Boolean)) {
    if (!normalizedArch(value) || normalizedArch(value) !== goArch) throw new Error(`Host architecture mismatch: Go ${host.gohostarch}, system/Node/runner ${value}; use an explicit --target.`);
  }
  const target = Object.values(TARGETS).find(item => item.goos === host.gohostos && item.goarch === host.gohostarch);
  if (!target) throw new Error(`Unsupported native platform ${host.gohostos}/${host.gohostarch}; supported: ${Object.keys(TARGETS).join(', ')}`);
  return target;
}

export function capture(command, args, env = environment()) {
  const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}

export function detectHost() {
  const go = JSON.parse(capture(goPath(), ['env', '-json', 'GOHOSTOS', 'GOHOSTARCH', 'GOOS', 'GOARCH']));
  return { gohostos: go.GOHOSTOS, gohostarch: go.GOHOSTARCH, goos: go.GOOS, goarch: go.GOARCH, platform: process.platform, arch: process.arch, systemArch: machine(), runnerArch: process.env.RUNNER_ARCH };
}

export function archiveManifest(source, target, version = source.version) {
  if (!/^[a-z][a-z0-9-]*$/.test(source.name ?? '')) throw new Error('Unsafe tool identity');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version ?? '') || source.version !== version) throw new Error('Tool/package version mismatch or invalid version');
  const entrypoint = `bin/${source.name}${target.suffix}`;
  return { ...source, runtime: { type: 'binary', binary: { entrypoint, ...(target.goos === 'darwin' ? { permissions: { [entrypoint]: '0o755' } } : {}) } } };
}

export async function createArchive(stage, destination, target) {
  const manifest = JSON.parse(await readFile(resolve(stage, 'manifest.json'), 'utf8'));
  const entrypoint = manifest.runtime.binary.entrypoint;
  if (entrypoint !== `bin/${manifest.name}${target.suffix}`) throw new Error('Invalid archive entrypoint');
  const executable = resolve(stage, entrypoint);
  if (!(await stat(executable)).isFile()) throw new Error('Missing binary entrypoint');
  if (target.extension === 'zip') {
    const zip = new yazl.ZipFile();
    zip.addFile(resolve(stage, 'manifest.json'), 'manifest.json', { mode: 0o100644 });
    zip.addFile(executable, entrypoint, { mode: 0o100755 });
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(destination));
  } else {
    await tar.c({ cwd: stage, file: destination, gzip: true, portable: true, strict: true,
      onWriteEntry(entry) { entry.stat.mode = entry.path === entrypoint ? 0o100755 : 0o100644; },
    }, ['manifest.json', entrypoint]);
  }
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceCommit() {
  try { return capture('git', ['rev-parse', 'HEAD']); } catch { return null; }
}

export async function packageNative({ target: explicitTarget, outputDir = resolve(ROOT, 'dist') } = {}) {
  const host = detectHost();
  const target = selectTarget(host, explicitTarget);
  if (process.env.NATIVE_TARGET && process.env.NATIVE_TARGET !== target.key) throw new Error(`Runner target mismatch: expected ${process.env.NATIVE_TARGET}, got ${target.key}`);
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  const source = JSON.parse(await readFile(resolve(ROOT, 'executas/mini-notes-summarizer/manifest.json'), 'utf8'));
  const manifest = archiveManifest(source, target, pkg.version);
  await mkdir(resolve(ROOT, '.tools'), { recursive: true });
  const stage = await mkdtemp(resolve(ROOT, '.tools/native-stage-'));
  await mkdir(outputDir, { recursive: true });
  const filename = `${source.name}-${pkg.version}-${target.key}.${target.extension}`;
  const archive = resolve(outputDir, filename);
  const temporary = `${archive}.partial`;
  try {
    await mkdir(resolve(stage, 'bin'));
    const binaryPath = resolve(stage, manifest.runtime.binary.entrypoint);
    const env = { ...environment(), CGO_ENABLED: '0', GOOS: target.goos, GOARCH: target.goarch };
    const buildTarget = JSON.parse(capture(goPath(), ['env', '-json', 'GOOS', 'GOARCH', 'CGO_ENABLED'], env));
    if (buildTarget.GOOS !== target.goos || buildTarget.GOARCH !== target.goarch || buildTarget.CGO_ENABLED !== '0') throw new Error('Go build target/CGO verification failed');
    await run(goPath(), ['build', '-trimpath', '-ldflags', '-s -w', '-o', binaryPath, '.'], { cwd: resolve(ROOT, 'executas/mini-notes-summarizer'), env });
    await chmod(binaryPath, 0o755);
    await writeFile(resolve(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await createArchive(stage, temporary, target);
    await rename(temporary, archive);
    const bytes = await readFile(archive), binary = await readFile(binaryPath);
    const metadata = { schema: 1, name: source.name, version: pkg.version, target: target.key, host, crossCompiled: target.goos !== host.gohostos || target.goarch !== host.gohostarch,
      sourceCommit: sourceCommit(), createdAt: new Date().toISOString(), toolchain: { node: process.version, go: capture(goPath(), ['version']), cgoEnabled: false },
      archive: { name: filename, size: bytes.length, sha256: sha256(bytes) }, binary: { entrypoint: manifest.runtime.binary.entrypoint, size: binary.length, sha256: sha256(binary) } };
    await writeFile(`${archive}.metadata.json`, JSON.stringify(metadata, null, 2) + '\n');
    await writeFile(`${archive}.sha256`, `${metadata.archive.sha256}  ${filename}\n`);
    console.log(`Packaged ${target.key}: ${archive}${metadata.crossCompiled ? ' (cross compiled; run smoke on its native runner)' : ''}`);
    return { archive, metadata };
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2), options = {};
    for (let index = 0; index < argv.length; index += 2) {
      if (!['--target', '--output-dir'].includes(argv[index]) || !argv[index + 1]) throw new Error('Usage: package-native.mjs [--target <platform-key>] [--output-dir <directory>]');
      options[argv[index] === '--target' ? 'target' : 'outputDir'] = argv[index] === '--target' ? argv[index + 1] : resolve(argv[index + 1]);
    }
    await packageNative(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
