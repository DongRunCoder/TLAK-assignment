export interface AnnaRuntime {
  storage: {
    get(args: { key: string }): Promise<{ value: unknown }>;
    set(args: { key: string; value: unknown }): Promise<unknown>;
  };
  tools: { invoke(args: { tool_id: string; method: string; args: unknown; timeoutMs: number }, options?: { timeoutMs: number }): Promise<unknown> };
  on?(event: string, handler: (payload: unknown) => void): () => void;
}
