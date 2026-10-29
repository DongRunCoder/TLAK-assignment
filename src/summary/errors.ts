export const NO_LLM_ERROR = 'SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm';

export class SummaryRequestError extends Error {
  constructor(message: string, readonly kind: 'no-llm' | 'failed' = 'failed') {
    super(message);
    this.name = 'SummaryRequestError';
  }
}

// Only a complete known message identifies no-llm. Arbitrary Host diagnostics
// can contain credentials or note text; never forward them to the UI.
export function safeSummaryError(error: unknown): SummaryRequestError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (raw === NO_LLM_ERROR || raw === '[-32603] harness started with --no-llm') {
    return new SummaryRequestError(NO_LLM_ERROR, 'no-llm');
  }
  const prefix = raw.slice(0, 128);
  const hostCode = /^SAMPLING_HOST_ERROR: \[(-\d{4,6})\](?: |$)/.exec(prefix)?.[1];
  if (hostCode) return new SummaryRequestError(`Host 未能完成总结请求（SAMPLING_HOST_ERROR: [${hostCode}]），请重试或检查 Host 配置。`);
  if (prefix.startsWith('SAMPLING_TIMEOUT:')) return new SummaryRequestError('Host 总结请求超时，请重试（SAMPLING_TIMEOUT）。');
  if (prefix.startsWith('TOOL_BUSY:')) return new SummaryRequestError('总结工具正在处理上一条请求，请稍后重试（TOOL_BUSY）。');
  if (prefix.startsWith('SAMPLING_UNAVAILABLE:')) return new SummaryRequestError('Host 暂不支持 sampling，请检查运行配置（SAMPLING_UNAVAILABLE）。');
  if (prefix.startsWith('SAMPLING_INVALID_RESPONSE:')) return new SummaryRequestError('Host 返回的总结格式或长度不符合要求，请重试（SAMPLING_INVALID_RESPONSE）。');
  return new SummaryRequestError('总结请求未完成，请重试并检查 Anna Host 的连接与授权。');
}
