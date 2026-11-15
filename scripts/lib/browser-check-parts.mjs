// The browser check in parts. verify runs each part as a step of its own, with its own server and
// time limit, so screens added to one part never push a single long step past its limit. The 360px
// runs share a part with a device's runs: their second PIN lock waits a minute after the first,
// and those device runs fill that minute. The part with `fullList` ends by filling its server's
// profile list, so nothing can follow it on that server. The part with `voice` plays "Read to me"
// at 360px in both languages, in Chromium only, whose browser is muted (scripts/lib/voice-check.mjs).
export const BROWSER_CHECK_PARTS = [
  { name: 'chromium-iphone', browser: 'chromium', devices: ['iphone-portrait'], narrow: false, fullList: false, voice: false },
  { name: 'chromium-ipad-360px', browser: 'chromium', devices: ['ipad-landscape'], narrow: true, fullList: true, voice: false },
  { name: 'chromium-voice', browser: 'chromium', devices: [], narrow: false, fullList: false, voice: true },
  { name: 'webkit-iphone', browser: 'webkit', devices: ['iphone-portrait'], narrow: false, fullList: false, voice: false },
  { name: 'webkit-ipad-360px', browser: 'webkit', devices: ['ipad-landscape'], narrow: true, fullList: false, voice: false },
];
