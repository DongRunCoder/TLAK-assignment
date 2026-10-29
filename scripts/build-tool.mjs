import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, goPath, run } from './lib.mjs';
mkdirSync(resolve(ROOT, '.build'), { recursive: true });
export const executable = resolve(ROOT, '.build', `mini-notes-summarizer${process.platform === 'win32' ? '.exe' : ''}`);
await run(goPath(), ['build', '-trimpath', '-o', executable, '.'], { cwd: resolve(ROOT, 'executas/mini-notes-summarizer') });
if (process.argv.includes('--test')) await run(process.execPath, [resolve(ROOT, 'scripts/test-protocol.mjs'), '--executable', executable, '--transcript', resolve(ROOT, 'evidence/protocol.jsonl')]);
