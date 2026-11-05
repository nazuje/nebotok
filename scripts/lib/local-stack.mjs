// What keeps the container checks of different worktrees apart on one Mac: each worktree gets its
// own compose project, image tag, published port and Docker network for compose.local.yaml.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { freePort } from './server-process.mjs';

// Local stacks take 10.231.<n>.16/28 with n from 100 to 199, well apart from production's 10.231.67.
const FIRST_OCTET = 100;
const OCTETS = 100;
const LOCAL_NETWORK = /^10\.231\.1\d\d$/;

/** The ports the live game may be published on: 8567, and NEBOTOK_PORT when it moves it. */
export function livePorts(env = process.env) {
  return [8567, ...(env.NEBOTOK_PORT ? [Number(env.NEBOTOK_PORT)] : [])];
}

/** An IPv4 CIDR range as its first and last address, as numbers. */
export function cidrRange(cidr) {
  const [address, bits] = cidr.split('/');
  const start = address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
  return [start, start + 2 ** (32 - Number(bits)) - 1];
}

/**
 * The first `10.231.<n>` prefix, counting from `start`, whose `.16/28` overlaps none of the `taken`
 * subnets, or null when all are taken. IPv6 subnets in `taken` are ignored.
 */
export function pickNetwork(taken, start) {
  const ranges = taken.filter((cidr) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr)).map(cidrRange);
  for (let step = 0; step < OCTETS; step += 1) {
    const prefix = `10.231.${FIRST_OCTET + ((start + step) % OCTETS)}`;
    const [first, last] = cidrRange(`${prefix}.16/28`);
    if (!ranges.some(([from, to]) => from <= last && first <= to)) return prefix;
  }
  return null;
}

/** Every subnet the Docker networks on this machine already use. */
function dockerSubnets() {
  const ids = spawnSync('docker', ['network', 'ls', '-q'], { encoding: 'utf8' }).stdout?.trim().split('\n').filter(Boolean) ?? [];
  if (ids.length === 0) return [];
  const listed = spawnSync('docker', ['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}', ...ids], { encoding: 'utf8' });
  return (listed.stdout ?? '').split(/\s+/).filter(Boolean);
}

/**
 * The local stack for the worktree at `root`. The project name and image tag come from the
 * worktree's path, so they stay the same from run to run; the port is free now unless
 * NEBOTOK_LOCAL_PORT names one, and the network is the first free one unless NEBOTOK_LOCAL_NETWORK
 * names one. COMPOSE_PROJECT_NAME from the caller is never used: it could name the production stack.
 * Neither setting may reach the live game: the port is never one of livePorts(), and the network
 * is always one of the local stacks' 10.231.100-199.
 */
export async function localStack(root, env = process.env) {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 8);
  const network = env.NEBOTOK_LOCAL_NETWORK ?? pickNetwork(dockerSubnets(), Number.parseInt(id, 16) % OCTETS);
  if (!network) throw new Error('container-check: every 10.231.100-199.16/28 network is taken; set NEBOTOK_LOCAL_NETWORK');
  if (!LOCAL_NETWORK.test(network)) throw new Error(`container-check: NEBOTOK_LOCAL_NETWORK must be 10.231.100 to 10.231.199, not ${network}`);
  const port = env.NEBOTOK_LOCAL_PORT ?? String(await freePort());
  if (!/^\d{1,5}$/.test(port) || livePorts(env).includes(Number(port))) {
    throw new Error(`container-check: NEBOTOK_LOCAL_PORT ${port} is not a port the local stack may use; the live game has ${livePorts(env).join(' and ')}`);
  }
  return {
    project: `nebotok-local-${id}`,
    image: `nebotok:local-${id}`,
    port,
    network,
  };
}
