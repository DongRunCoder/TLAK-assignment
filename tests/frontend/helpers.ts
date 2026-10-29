import { vi } from 'vitest';
import type { AnnaRuntime } from '../../src/anna/types';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function host(initial: unknown = null) {
  let value: unknown = initial;
  const storage = {
    get: vi.fn(async () => ({ value: structuredClone(value) })),
    set: vi.fn(async ({ value: next }: { key: string; value: unknown }): Promise<unknown> => { value = structuredClone(next); return { ok: true }; }),
  };
  const runtime: AnnaRuntime = { storage, tools: { invoke: vi.fn() } };
  return { runtime, storage, value: () => value, put: (next: unknown) => { value = structuredClone(next); } };
}
export const note = (sequence = 1, content = 'first') => ({ id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, sequence, content, createdAt: '2026-10-29T00:00:00.000Z' });
export const doc = (notes = [note()], revision = 1, nextSequence = notes.length + 1) => ({ schemaVersion: 1 as const, revision, nextSequence, notes });
export const denied = () => Object.assign(new Error('write denied'), { code: 'permission_denied' });
export const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
