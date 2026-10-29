import { createRoot } from 'react-dom/client';
import { createConnection } from './anna/runtime';
import type { AnnaRuntime } from './anna/types';
import { MiniNotesApp } from './components/MiniNotesApp';
import './styles.css';

const sdkPath = '/static/anna-apps/_sdk/latest/index.js';
const connection = createConnection(async () => {
  const { AnnaAppRuntime } = await import(/* @vite-ignore */ sdkPath);
  return AnnaAppRuntime.connect() as Promise<AnnaRuntime>;
});
createRoot(document.getElementById('root')!).render(<MiniNotesApp connection={connection} />);
