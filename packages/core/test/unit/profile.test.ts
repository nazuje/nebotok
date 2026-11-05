import { describe, expect, it } from 'vitest';
import { AddPinRequest, CreateProfileRequest, LoginRequest, Pin, ProfileName, REQUIRED_STRING_IDS, PROFILE_ERRORS, nameKey } from '../../src/index.ts';

describe('profile names', () => {
  it.each([
    ['Test Courier', 'Test Courier'],
    ['  Čmrlj   Šumež ', 'Čmrlj Šumež'],
    ['Žarek', 'Žarek'],
    ['Đuro Ćuk', 'Đuro Ćuk'],
    ['c\u030Cmrlj', 'čmrlj'],
    ['A', 'A'],
    ['Abcdefghijklmnop', 'Abcdefghijklmnop'],
  ])('accepts %j as %j', (raw, stored) => {
    expect(ProfileName.parse(raw)).toBe(stored);
  });

  it.each(['', '   ', 'Abcdefghijklmnopq', 'R2D2', 'Ana-Marija', 'Zoë', '<b>', 'Tab\u0000'])('refuses %j', (raw) => {
    expect(ProfileName.safeParse(raw).success).toBe(false);
  });

  it('treats capitals and spacing as the same name', () => {
    expect(nameKey(' ČMRLJ  šumež')).toBe(nameKey('čmrlj Šumež'));
  });
});

describe('profile requests', () => {
  it('accepts a four digit PIN only', () => {
    expect(Pin.safeParse('0420').success).toBe(true);
    for (const bad of ['123', '12345', 'abcd', ' 123', '١٢٣٤']) expect(Pin.safeParse(bad).success).toBe(false);
  });

  it('refuses unknown fields', () => {
    expect(CreateProfileRequest.safeParse({ name: 'Test', avatar: 'blue', admin: true }).success).toBe(false);
    expect(LoginRequest.safeParse({ profileId: 1, token: 'x' }).success).toBe(false);
    expect(LoginRequest.safeParse({ profileId: 0 }).success).toBe(false);
  });

  it('asks for exactly a PIN when adding one', () => {
    expect(AddPinRequest.safeParse({ pin: '0420' }).success).toBe(true);
    expect(AddPinRequest.safeParse({}).success).toBe(false);
    expect(AddPinRequest.safeParse({ pin: '042' }).success).toBe(false);
    expect(AddPinRequest.safeParse({ pin: '0420', profileId: 2 }).success).toBe(false);
  });

  it('has a string for every error the API can answer with', () => {
    for (const code of PROFILE_ERRORS) expect(REQUIRED_STRING_IDS).toContain(`profile.error.${code}`);
  });
});
