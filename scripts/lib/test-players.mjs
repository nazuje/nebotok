// The players the browser check makes. Each run tags its names with three letters of its own, so a
// run never collides with players an earlier run left behind, and isTestPlayer() recognises them,
// for scripts/container-check.mjs to delete inside its own local stack.
import { randomInt } from 'node:crypto';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Three letters, such as "Qeb": profile names take only letters and spaces. */
export function runTag(pick = randomInt) {
  const [first, ...rest] = Array.from({ length: 3 }, () => LETTERS[pick(LETTERS.length)]);
  return `${first.toUpperCase()}${rest.join('')}`;
}

export const botName = (tag) => `Bot Oblak ${tag}`;
export const deviceName = (browserName, device, language, tag) =>
  `${browserName === 'chromium' ? 'Kro' : 'Web'} ${device.startsWith('iphone') ? 'Tel' : 'Tab'} ${language === 'sl' ? 'Čšž' : 'Abc'} ${tag}`;
/** A profile the check locks with wrong PINs: `lock` is 'Zaklep' (locked once) or 'Dvakrat' (twice). */
export const lockedName = (lock, browserName, tag) => `${lock} ${browserName === 'chromium' ? 'Kro' : 'Web'} ${tag}`;

/** A profile made without a PIN, to add one from the settings; two letters keep it within 16. */
export const pinlessName = (browserName, language, tag) => `Dodaj ${browserName === 'chromium' ? 'Kro' : 'Web'} ${language === 'sl' ? 'Čž' : 'Ab'} ${tag}`;
/** A profile whose save the check writes, to learn a move at its next level up. */
export const learnerName = (browserName, language, tag) => `Uči ${browserName === 'chromium' ? 'Kro' : 'Web'} ${language === 'sl' ? 'Čž' : 'Ab'} ${tag}`;

/** A profile the check starts from a prepared save, to play the battles: "Boj" with the browser and device in two letters. */
export const battlerName = (browserName, device, language, tag) => `Boj ${browserName === 'chromium' ? 'K' : 'W'}${device.startsWith('iphone') ? 'T' : 'P'} ${language === 'sl' ? 'Čž' : 'Ab'} ${tag}`;

/** A profile the check starts from a prepared save with a quest under way: "Pot" with the browser and device in two letters. */
export const storyName = (browserName, device, language, tag) => `Pot ${browserName === 'chromium' ? 'K' : 'W'}${device.startsWith('iphone') ? 'T' : 'P'} ${language === 'sl' ? 'Čž' : 'Ab'} ${tag}`;

// Without a tag too: runs before tags left their players under the bare names.
const TEST_PLAYER = /^(?:Bot Oblak|(?:Kro|Web) (?:Tel|Tab) (?:Abc|Čšž)|(?:Zaklep|Dvakrat) (?:Kro|Web)|Dodaj (?:Kro|Web) (?:Abc|Čšž|Ab|Čž)|(?:Boj|Pot) [KW][TP] (?:Ab|Čž)|Uči (?:Kro|Web) (?:Ab|Čž))(?: [A-Z][a-z]{2})?$/;
export const isTestPlayer = (name) => TEST_PLAYER.test(name);
