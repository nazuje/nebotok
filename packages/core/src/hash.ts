/**
 * A stable fingerprint of plain data: the same value hashes the same on every machine and run.
 * Object keys are sorted, so key order never changes the hash.
 */

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson() cannot encode a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item: Json) => canonicalJson(item)).join(',')}]`;
  const record = value as { readonly [key: string]: Json };
  const entries = Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as Json)}`);
  return `{${entries.join(',')}}`;
}

/** cyrb53: a small 53-bit string hash, returned as 14 hex digits. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

export function stableHash(value: Json): string {
  return cyrb53(canonicalJson(value));
}
