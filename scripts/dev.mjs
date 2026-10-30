import { runPreview } from './preview.mjs';

try { await runPreview(); }
catch {
  console.error('Invalid preview options. Run npm run dev:preview -- --help.');
  process.exitCode = 1;
}
