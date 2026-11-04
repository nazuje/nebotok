import { z } from 'zod';

/**
 * The page's Content-Security-Policy forbids eval. Without jitless mode, zod probes for eval with
 * new Function on its first parse and every browser files a CSP violation report.
 */
export function forbidEval(): void {
  z.config({ jitless: true });
}
