import { describe, expect, it, vi } from 'vitest';
import { createConnection } from '../../src/anna/runtime';
import type { AnnaRuntime } from '../../src/anna/types';

describe('Anna connection lifecycle', () => {
  it('shares one successful connection between callers', async () => {
    const runtime = {} as AnnaRuntime;
    const loader = vi.fn().mockResolvedValue(runtime);
    const connection = createConnection(loader);
    const [a, b] = await Promise.all([connection.connect(), connection.connect()]);
    expect(a).toBe(runtime); expect(b).toBe(runtime); expect(loader).toHaveBeenCalledTimes(1);
  });
  it('clears a rejected connection so an explicit retry can succeed', async () => {
    const runtime = {} as AnnaRuntime;
    const loader = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(runtime);
    const connection = createConnection(loader);
    await expect(connection.connect()).rejects.toThrow('unavailable');
    await expect(connection.connect()).resolves.toBe(runtime);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
