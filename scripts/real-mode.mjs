import { relative, resolve } from 'node:path';
import { ROOT } from './lib.mjs';

export const REAL_DEFAULT_ACCOUNT = 'https://anna.partners';
export const REAL_DEFAULT_APP_SLUG = 'mini-notes-tlak-real';

export function validateRealAccount(value) {
  // Validate the original text too: URL parsing normalizes /a/.., empty ?/#,
  // backslashes and empty userinfo, which must never hide credential-bearing URLs.
  if (typeof value !== 'string' || !/^https?:\/\/[^\s/@?#\\]+\/?$/.test(value)) throw new Error('Invalid LLM account origin.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid LLM account origin.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Invalid LLM account origin.');
  return url.origin;
}

export function validateRealAppSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) throw new Error('Invalid LLM app slug.');
  return value;
}

export function buildPreviewHostArgs({ llm = 'off', port, bundle = './bundle', account = REAL_DEFAULT_ACCOUNT, appSlug = REAL_DEFAULT_APP_SLUG }) {
  if (!['off', 'real'].includes(llm)) throw new Error('Unsupported preview LLM mode.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port.');
  if (llm === 'off') return ['dev', '--no-llm', '--storage', 'legacy', '--bundle', bundle, '--port', String(port)];
  const location = relative(ROOT, resolve(ROOT, bundle)).replaceAll('\\', '/');
  if (!/^\.tools\/real-preview-[a-zA-Z0-9_-]+\/bundle$/.test(location)) throw new Error('Real preview requires an isolated bundle.');
  return ['dev', '--storage', 'legacy', '--bundle', bundle, '--port', String(port), '--no-watch', '--llm-account', validateRealAccount(account), '--llm-app-slug', validateRealAppSlug(appSlug)];
}

export const REAL_STARTUP_MESSAGES = Object.freeze({
  account: 'Real preview is not logged in to the selected account. Run npm exec anna-app -- login --host <account-origin>, then retry.',
  expired: 'Real preview account has expired. Run npm exec anna-app -- login --host <account-origin> again, then retry.',
  metadata: 'Real preview account metadata is unavailable or invalid. Log in again with the official Anna CLI, then retry.',
  handle: 'Real preview requires a developer handle. Set it in the developer console or with npm exec anna-app -- account set-handle <handle> --host <account-origin>.',
  developer: 'Real preview requires developer access. Activate developer access in the selected account developer console, then retry.',
  unauthorized: 'Real preview account was rejected (401/403). Log in again and check developer permissions for the selected account.',
  network: 'Real preview network connection failed. Check the proxy, network and account service, then retry.',
  startup: 'Real preview could not start. Check the official Anna CLI installation and project configuration, then retry.',
});

export function parseRealAccountMetadata(source, account, now = Date.now()) {
  let data;
  try { data = JSON.parse(source); } catch { throw new Error(REAL_STARTUP_MESSAGES.metadata); }
  if (!data || !Array.isArray(data.accounts) || data.accounts.some(value => !value || typeof value.host !== 'string')) throw new Error(REAL_STARTUP_MESSAGES.metadata);
  const selected = data.accounts.find(value => value.host === account);
  if (!selected) throw new Error(REAL_STARTUP_MESSAGES.account);
  const expiry = selected.expires_at;
  if (!Number.isSafeInteger(expiry) || expiry < 0) throw new Error(REAL_STARTUP_MESSAGES.metadata);
  if (expiry <= Math.floor(now / 1000)) throw new Error(REAL_STARTUP_MESSAGES.expired);
  // Never return whoami's pat_preview, user_id, current account or scopes.
  return { host: selected.host, expires_at: expiry };
}

// Keep at most a short overlap while classifying split stdout/stderr chunks.
// Neither full startup output nor response bodies are logged or written to disk.
// After readiness/cleanup clear() disables capture permanently and drops overlap.
export function createRealStartupDiagnostics() {
  let tail = '', active = true;
  const found = new Set();
  const patterns = [
    ['handle', /developer handle|HANDLE_REQUIRED/i],
    ['developer', /verified developer required|developer access|developer required/i],
    ['expired', /PAT expired|account.{0,20}expired/i],
    ['account', /no developer PAT|not logged in|PAT not found/i],
    ['unauthorized', /\b(?:401|403)\b|unauthorized|forbidden/i],
    ['network', /fetch failed|ECONN\w+|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|proxy|network|socket hang up/i],
  ];
  return {
    consume(chunk) {
      if (!active) return;
      // Scan bounded blocks even if a child writes a very large response body.
      const source = chunk.toString('utf8');
      for (let offset = 0; offset < source.length; offset += 1024) {
        const block = tail + source.slice(offset, offset + 1024);
        for (const [category, pattern] of patterns) if (pattern.test(block)) found.add(category);
        tail = block.slice(-128);
      }
    },
    message() { return REAL_STARTUP_MESSAGES[patterns.find(([category]) => found.has(category))?.[0] ?? 'startup']; },
    clear() { active = false; tail = ''; found.clear(); },
  };
}
