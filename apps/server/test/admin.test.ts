import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdmin } from '../src/admin.ts';
import { tempServices } from './helpers.ts';

let temp: ReturnType<typeof tempServices>;
let lines: string[];
let errors: string[];
beforeEach(() => {
  temp = tempServices();
  lines = [];
  errors = [];
});
afterEach(() => temp.dispose());

const admin = (...args: string[]) => runAdmin(args, temp.services.profiles, { out: (line) => lines.push(line), error: (line) => errors.push(line) });

async function made(name: string, pin?: string): Promise<number> {
  const result = await temp.services.profiles.create(pin === undefined ? { name, avatar: 'yellow' } : { name, avatar: 'yellow', pin });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

describe('admin CLI', () => {
  it('lists profiles, or says there are none', async () => {
    expect(await admin('list')).toBe(0);
    expect(lines).toEqual(['no profiles yet']);
    await made('Test Courier', '1234');
    lines = [];
    expect(await admin('list')).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\s+\d+\s+Test Courier\s+yellow\s+PIN$/);
  });

  it('resets a PIN and prints the new one, matching names in any capitals and spacing', async () => {
    const id = await made('Test Courier', '1234');
    expect(await admin('reset-pin', 'test', 'COURIER')).toBe(0);
    const pin = /PIN (\d{4})\./.exec(lines[0] ?? '')?.[1];
    expect(pin).toBeDefined();
    expect((await temp.services.profiles.login({ profileId: id, pin: pin! })).ok).toBe(true);
  });

  it('removes a PIN', async () => {
    const id = await made('Test Courier', '1234');
    expect(await admin('remove-pin', 'Test Courier')).toBe(0);
    expect(temp.services.profiles.get(id)?.hasPin).toBe(false);
  });

  it('deletes a profile', async () => {
    const id = await made('Test Courier');
    expect(await admin('delete', 'Test Courier')).toBe(0);
    expect(temp.services.profiles.get(id)).toBeUndefined();
  });

  it('refuses an unknown name or command with a non-zero exit', async () => {
    expect(await admin('delete', 'Nobody')).toBe(1);
    expect(errors[0]).toMatch(/no profile is called "Nobody"/);
    expect(await admin('delete')).toBe(2);
    expect(await admin('drop', 'tables')).toBe(2);
    expect(await admin()).toBe(2);
    expect(errors.at(-1)).toMatch(/^usage:/);
  });
});
