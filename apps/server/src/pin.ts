import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_BYTES = 32;
const SALT_BYTES = 16;
// scrypt's recommended interactive cost: about 50 ms and 16 MiB per check.
const COST: ScryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type PinHash = { readonly hash: Uint8Array; readonly salt: Uint8Array };

function derive(pin: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_BYTES, COST, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPin(pin: string): Promise<PinHash> {
  const salt = randomBytes(SALT_BYTES);
  return { hash: await derive(pin, salt), salt };
}

/** Compares in constant time, so how long a check takes says nothing about how close a guess was. */
export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  const key = await derive(pin, stored.salt);
  return key.length === stored.hash.length && timingSafeEqual(key, stored.hash);
}
