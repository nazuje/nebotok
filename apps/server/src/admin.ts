// Profile admin for the person who runs the server. In the container: scripts/admin.sh <command>.
// Outside it: node apps/server/src/admin.ts <command>, against DATA_DIR (default .local-data/).
// It prints names to the terminal it runs in and nowhere else.
import { readConfig } from './config.ts';
import type { ProfileStore } from './profiles.ts';
import { createServices } from './services.ts';

export const ADMIN_USAGE = `usage: admin.ts <command>
  list               every profile: id, name, avatar, PIN, lock
  reset-pin <name>   give the profile a new random PIN, printed once, and sign it out everywhere
  remove-pin <name>  take the PIN off, so the profile opens without one
  delete <name>      delete the profile with its progress (only a backup can bring it back)`;

type Output = { out(line: string): void; error(line: string): void };

function listLines(profiles: ProfileStore): string[] {
  const rows = profiles.list();
  if (rows.length === 0) return ['no profiles yet'];
  return rows.map((row) => {
    const pin = row.hasPin ? 'PIN' : 'no PIN';
    const lock = row.lockedForSeconds > 0 ? `, locked for ${row.lockedForSeconds} s` : '';
    return `${String(row.id).padStart(3)}  ${row.name.padEnd(16)}  ${row.avatar.padEnd(8)}  ${pin}${lock}`;
  });
}

/** Runs one admin command and returns the process exit code. */
export async function runAdmin(args: readonly string[], profiles: ProfileStore, output: Output): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'list' && rest.length === 0) {
    for (const line of listLines(profiles)) output.out(line);
    return 0;
  }
  const name = rest.join(' ');
  if (!['reset-pin', 'remove-pin', 'delete'].includes(command ?? '') || name.trim() === '') {
    output.error(ADMIN_USAGE);
    return 2;
  }
  const profile = profiles.findByName(name);
  if (!profile) {
    output.error(`no profile is called "${name}". See: admin.ts list`);
    return 1;
  }
  if (command === 'reset-pin') {
    const pin = await profiles.resetPin(profile.id);
    output.out(`${profile.name} now has PIN ${pin}. Every device was signed out; any open game asks again when it next joins.`);
  } else if (command === 'remove-pin') {
    profiles.removePin(profile.id);
    output.out(`${profile.name} has no PIN now.`);
  } else {
    profiles.remove(profile.id);
    output.out(`${profile.name} was deleted with its progress.`);
  }
  return 0;
}

if (import.meta.main) {
  const services = createServices(readConfig(process.env));
  try {
    process.exitCode = await runAdmin(process.argv.slice(2), services.profiles, {
      out: (line) => process.stdout.write(`${line}\n`),
      error: (line) => process.stderr.write(`${line}\n`),
    });
  } finally {
    services.close();
  }
}
