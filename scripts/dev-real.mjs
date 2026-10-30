import { runPreview } from './preview.mjs';

try { await runPreview(process.argv.slice(2), { llm: 'real' }); }
catch { console.error('Invalid real preview options. Run npm run dev:real -- --help.'); process.exitCode = 1; }
