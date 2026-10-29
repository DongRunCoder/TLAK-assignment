import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Compare original binary/archive descriptions without persisting descriptions
// in the public protocol transcript. Object ordering is not semantically relevant.
export function describeFingerprint(manifest) {
  const fields = Object.fromEntries(['name', 'version', 'tools', 'host_capabilities'].map(key => [key, manifest[key]]));
  return createHash('sha256').update(JSON.stringify(canonical(fields))).digest('hex');
}
