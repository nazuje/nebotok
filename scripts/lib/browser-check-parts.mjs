// The browser check in parts. verify runs each part as a step of its own, with its own server and
// time limit, so screens added to one part never push a single long step past its limit. The 360px
// runs share a part with a device's runs: their second PIN lock waits a minute after the first,
// and those device runs fill that minute. The part with `fullList` ends by filling its server's
// profile list, so nothing can follow it on that server.
export const BROWSER_CHECK_PARTS = [
  { name: 'chromium-iphone', browser: 'chromium', devices: ['iphone-portrait'], narrow: false, fullList: false },
  { name: 'chromium-ipad-360px', browser: 'chromium', devices: ['ipad-landscape'], narrow: true, fullList: true },
  { name: 'webkit-iphone', browser: 'webkit', devices: ['iphone-portrait'], narrow: false, fullList: false },
  { name: 'webkit-ipad-360px', browser: 'webkit', devices: ['ipad-landscape'], narrow: true, fullList: false },
];
