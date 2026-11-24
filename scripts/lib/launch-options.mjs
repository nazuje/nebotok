// How proof runs launch browsers. Always headless. Chromium gets software WebGL so it works with no
// graphics card, and --mute-audio so a test run can never play sound through the computer's speakers.
// WebKit has no mute switch; the game itself starts Phaser with audio disabled, and in an automated
// browser its Web Audio effects are never connected to the speakers (apps/game/src/sound.ts).
export const chromiumLaunchOptions = {
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
};

export const webkitLaunchOptions = {
  headless: true,
};
