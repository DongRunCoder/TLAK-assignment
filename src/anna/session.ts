import type { AnnaRuntime } from './types';

export type HostStatus = 'checking' | 'online' | 'expired' | 'unavailable';
// Only this local sentinel proves no RPC was dispatched. A real Host session
// error after storage.set was sent still has an unknown write outcome.
export class HostOperationBlockedError extends Error {
  readonly code = 'host_operation_not_sent';
  constructor() { super('Anna 连接尚未恢复，操作未发送；请保留草稿并重新读取。'); }
}
export function classifySessionError(error: unknown): 'expired' | 'unavailable' | null {
  const record = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown } : undefined;
  const message = typeof error === 'string' ? error : typeof record?.message === 'string' ? record.message : '';
  const code = record?.code;
  // Fixed CLI transport diagnostics and direct JSON-RPC errors only. In
  // particular, sampling text mentioning a session is not a Host session error.
  if (message.length <= 512 && (code === undefined || code === 'transport' || code === -32602 || code === 'invalid_params') &&
      /^(?:\[-32602\] )?unknown session_id: [A-Za-z0-9._:-]{1,256}$/.test(message)) return 'expired';
  if (code === 'transport' || code === 'timeout' || code === 'disconnected' ||
      (message.length <= 256 && /^RPC (?:storage\.(?:get|set)|tools\.invoke) timed out after [1-9][0-9]{0,8}ms \(pass \{ timeoutMs \} as the 2nd arg to override\)$/.test(message)) ||
      (message.length <= 256 && /^(?:Host RPC timeout|RPC timeout|Request timed out|Connection closed|connection closed)(?:[.!])?$/.test(message))) return 'unavailable';
  return null;
}
export class HostSession {
  private status: HostStatus = 'checking';
  constructor(private onChange: (status: HostStatus) => void = () => {}) {}
  getStatus(): HostStatus { return this.status; }
  private update(status: HostStatus): void {
    if (this.status === 'expired' || status === this.status) return;
    this.status = status; this.onChange(status);
  }
  fail(error: unknown): void { const status = classifySessionError(error); if (status) this.update(status); }
  observe(runtime: AnnaRuntime): AnnaRuntime {
    const call = async <T>(operation: () => Promise<T>, read = false): Promise<T> => {
      try { const result = await operation(); if (read) this.update('online'); return result; }
      catch (error) { this.fail(error); throw error; }
    };
    const write = <T>(operation: () => Promise<T>) => call(() => {
      if (this.status !== 'online') throw new HostOperationBlockedError();
      return operation();
    });
    return {
      storage: {
        get: args => call(() => runtime.storage.get(args), true),
        set: args => write(() => runtime.storage.set(args)),
      },
      tools: { invoke: (args, options) => write(() => runtime.tools.invoke(args, options)) },
      ...(runtime.on ? { on: (event: string, handler: (payload: unknown) => void) => runtime.on!(event, handler) } : {}),
    };
  }
}
