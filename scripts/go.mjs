import { resolve } from 'node:path';
import { ROOT, goPath, run } from './lib.mjs';
await run(goPath(), process.argv.slice(2), { cwd: resolve(ROOT, 'executas/mini-notes-summarizer') });
