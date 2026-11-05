import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_GAME_DIST = fileURLToPath(new URL('../../game/dist/', import.meta.url));
/** Outside the container: a folder in the repository that git ignores. The image sets DATA_DIR=/data. */
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../.local-data/', import.meta.url));

/**
 * One entry of TRUST_PROXY: `loopback`, an IP address, or a CIDR range. A /0 range would trust every
 * peer, like Express's `true`, so it is refused along with `true`, `*` and hop counts.
 */
function isTrustedProxy(entry: string): boolean {
  if (entry === 'loopback') return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (family === 4 ? 32 : 128);
}

const TrustProxy = z
  .string()
  .default('loopback')
  .transform((value) => value.split(',').map((entry) => entry.trim()))
  .refine((entries) => entries.every(isTrustedProxy), 'a comma-separated list of "loopback", IP addresses and CIDR ranges (never true or *)');

const Env = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(2567),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  GAME_DIST: z.string().min(1).default(DEFAULT_GAME_DIST),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY: TrustProxy,
});

export type Config = {
  readonly port: number;
  readonly host: string;
  /** Where the database (and its nightly snapshots) live. */
  readonly dataDir: string;
  /** The built game. Served only in production. */
  readonly gameDist: string;
  readonly production: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** The peers whose X-Forwarded-For and X-Forwarded-Host are believed, as Express's `trust proxy`. */
  readonly trustProxy: readonly string[];
};

/** All configuration comes from the environment; nothing secret lives in the code. */
export function readConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`bad environment: ${problems}`);
  }
  const { PORT, HOST, DATA_DIR, GAME_DIST, NODE_ENV, LOG_LEVEL, TRUST_PROXY } = parsed.data;
  return {
    port: PORT,
    host: HOST,
    dataDir: DATA_DIR,
    gameDist: GAME_DIST,
    production: NODE_ENV === 'production',
    logLevel: LOG_LEVEL,
    trustProxy: TRUST_PROXY,
  };
}
