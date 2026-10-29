import type { AnnaRuntime } from './types';

export function createConnection(loader: () => Promise<AnnaRuntime>): { connect(): Promise<AnnaRuntime> } {
  let pending: Promise<AnnaRuntime> | undefined;
  return { connect() {
    if (!pending) {
      const attempt = Promise.resolve().then(loader);
      pending = attempt;
      void attempt.catch(() => { if (pending === attempt) pending = undefined; });
    }
    return pending;
  } };
}
