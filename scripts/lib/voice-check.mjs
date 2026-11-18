// "Read to me", played the way a player would against the real server, in muted headless Chromium
// only: a page asks for a clip by URL, and the check answers every /voice/ request itself with an
// empty clip, so nothing is ever heard, and notes each URL asked for. The player starts from the
// story check's save (scripts/lib/story-check.mjs), carrying a delivery to a character. With "Read
// to me" off, as for every player at first, the player turns it on in the settings and comes back
// after a reload with it still on (it is saved with the player). Handing the delivery over, every
// line with a clip is asked for as it starts, in its speaker's voice, and the banner of the step
// done asks for its hint's clip, and again from its speaker button. A character then offering a
// quest has its line read and then each choice in the narrator's voice, each choice showing its
// picture, and all again from the talk box's speaker button; the quest is put off. With "Read to
// me" turned off again, the character's next line asks for nothing until the talk box's speaker
// button is tapped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inWorld, nextFrames, openTalk, readState, talkThrough, until } from './game-page.mjs';
import { inTurn, poll } from './in-turn.mjs';
import { ROOT } from './server-process.mjs';

const CLIPS = JSON.parse(readFileSync(join(ROOT, 'apps/game/src/voice-clips.json'), 'utf8'));
const NPCS = new Map(JSON.parse(readFileSync(join(ROOT, 'content/npcs.json'), 'utf8')).npcs.map((npc) => [npc.id, npc]));

/** The clip the game should ask for: as `voiceClip` in apps/game/src/voice-clips.ts, by the speaker's npcs.json voice, or null. */
export function clipFor(language, speaker, text) {
  const voice = speaker === null ? null : NPCS.get(speaker)?.voice;
  const key = voice ? `pitch${voice.pitch}-pace${voice.pace}` : 'narrator';
  const file = CLIPS[language]?.[key]?.[text];
  return file === undefined ? null : `/voice/${language}/${file}`;
}

/**
 * Answers every clip the context asks for with an empty one, so no sound can play even if a muted
 * browser were not, and returns the paths asked for, in order. Service workers must be blocked in
 * the context, so none of them answers in its place.
 */
export async function silenceClips(context) {
  const asked = [];
  await context.route('**/voice/**', (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0) });
  });
  return asked;
}

/** The talk's first line, shown whole, and the clip it has. */
async function firstLine(page, npc, language) {
  const state = await until(page, (s) => s.talk?.npc === npc && s.talk.typed && !s.talk.waiting, `${npc}'s first line shown whole`);
  await nextFrames(page);
  return { state, clip: clipFor(language, state.talk.speaker, state.talk.line) };
}

/** The talk box's speaker button shows exactly when the line has a clip, at least 48px. */
async function speakerShown(page, clip, where, expect) {
  const button = page.locator('#talk .talk-speaker');
  const visible = await button.isVisible();
  expect(visible === (clip !== null), `${where}: the talk box ${visible ? 'shows' : 'hides'} its speaker button for a line ${clip === null ? 'without' : 'with'} a clip`);
  return visible;
}

/** The settings show "Read to me" with the speaker picture; a tap turns it over. With `shots`, screenshots before and after. */
async function setReadToMe(page, on, { expect, check, shots = null }) {
  await page.locator('.settings-button').tap();
  await until(page, (s) => s.settingsOpen, 'the settings');
  const toggle = page.locator('#settings .read-to-me');
  expect(await toggle.isVisible(), 'the settings show no "Read to me"');
  expect(await toggle.locator('[data-picture="pictures/speaker"]').isVisible(), '"Read to me" shows no speaker picture');
  expect((await toggle.getAttribute('aria-pressed')) === String(!on), `"Read to me" is not shown ${on ? 'off' : 'on'} before the tap`);
  if (shots) await check(`the settings with "Read to me" ${on ? 'off' : 'on'}`, shots[0]);
  await toggle.tap();
  await until(page, (s) => s.voice.readToMe === on, `"Read to me" to turn ${on ? 'on' : 'off'}`);
  await nextFrames(page);
  expect((await toggle.getAttribute('aria-pressed')) === String(on), `"Read to me" is not shown ${on ? 'on' : 'off'} after a tap`);
  if (shots) await check(`the settings with "Read to me" ${on ? 'on' : 'off'}`, shots[1]);
  await page.locator('.settings-button').tap();
  await until(page, (s) => !s.settingsOpen, 'the settings to close');
}

/**
 * On: handing the delivery over, each line with a clip asks for it as it shows, with the talk box's
 * speaker button beside it; then the banner of the step done asks for its hint's clip, and its
 * speaker button asks again.
 */
async function onTalk(page, world, plan, { language, asked, expect, check, notes }) {
  await openTalk(page, world, plan.handover, { notes });
  let lines = 0;
  const heard = async (s) => {
    const clip = clipFor(language, s.talk.speaker, s.talk.line);
    lines += 1;
    if (clip === null) {
      notes.push(`"${s.talk.line}" has no clip in ${language}`);
      return;
    }
    expect(s.voice.clip === clip, `with "Read to me" on, "${s.talk.line}" asked for ${s.voice.clip}, not ${clip}`);
    await speakerShown(page, clip, `the line "${s.talk.line}"`, expect);
    if (lines === 1) await check('the talk box with its speaker button', 'v3-talk-speaker');
  };
  await talkThrough(page, { seen: heard });
  expect(lines > 0, `the talk with ${plan.handover} showed no line whole`);
  const hint = plan.quest.steps[plan.at + 1]?.hint[language] ?? null;
  const clip = hint === null ? null : clipFor(language, null, hint);
  const shown = await until(page, (s) => s.questToast?.quest === plan.quest.id && s.questToast.change === 'step', 'the banner of the step done', 15_000);
  if (clip === null) {
    notes.push(`the hint after handing ${plan.quest.id}'s delivery over has no clip in ${language}`);
    return;
  }
  const read = await until(page, (s) => s.voice.clip === clip, `the banner to ask for its hint "${hint}"`, 5_000).catch(() => shown);
  expect(read.voice.clip === clip, `the banner of the step done asked for ${read.voice.clip}, not ${clip} for "${hint}"`);
  const button = page.locator('.quest-toast .quest-speaker');
  expect(await button.isVisible(), 'the banner of the step done shows no speaker button');
  // Past the banner's quarter-second fade in, so the screenshot shows it as it stays.
  await page.waitForTimeout(400);
  await check('the quest banner with its speaker button', 'v4-banner-speaker');
  const before = (await readState(page)).voice.asked;
  await button.tap();
  const again = await until(page, (s) => s.voice.asked === before + 1, "the banner's speaker button to ask for the hint", 5_000);
  expect(again.voice.clip === clip, `the banner's speaker button asked for ${again.voice.clip}, not ${clip}`);
  expect(asked.includes(clip), `the banner's hint clip ${clip} was never requested: ${JSON.stringify(asked)}`);
}

/** The clips of a talk's line and then of its choices, in the narrator's voice, in the order "Read to me" asks for them. */
const lineAndChoiceClips = (language, talk) => [clipFor(language, talk.speaker, talk.line), ...talk.choices.map((choice) => clipFor(language, null, choice.say))].filter((clip) => clip !== null);

/** Whether `list` holds every one of `wanted` in that order, with anything between. */
function inOrder(list, wanted) {
  let at = 0;
  for (const each of list) if (each === wanted[at]) at += 1;
  return at === wanted.length;
}

/** Each choice button's picture and kind, as the talk box shows them. */
const choiceLooksNow = (page) =>
  page.locator('#talk .talk-choice:visible').evaluateAll((buttons) => buttons.map((button) => ({ picture: button.querySelector('[data-picture]')?.getAttribute('data-picture') ?? null, kind: button.getAttribute('data-kind') })));

/** The choice buttons' looks once all `count` show a picture, or as they are after 5 seconds: the buttons are drawn a few frames after the line shows whole. */
async function choiceLooks(page, count) {
  let looks = [];
  await poll(
    async () => {
      looks = await choiceLooksNow(page);
      return looks.length === count && looks.every((look) => look.picture !== null);
    },
    { deadline: Date.now() + 5_000, intervalMs: 50 },
  );
  return looks;
}

/**
 * On, with a quest on offer: the line's clip is asked for, then each choice's in turn, in the
 * narrator's voice, while each choice shows its picture; the talk box's speaker button asks for the
 * line and the choices again. The quest is put off, so nothing else changes.
 */
async function choicesTalk(page, world, { language, asked, expect, check, notes }) {
  const offered = await until(page, (s) => s.talk === null && s.npcs.some((npc) => npc.mark === 'newQuest'), 'a character with a quest to offer', 10_000).catch(() => null);
  if (!offered) {
    notes.push('no character offered a quest after the delivery, so choices were not read');
    return;
  }
  const giver = offered.npcs.find((npc) => npc.mark === 'newQuest').id;
  const before = { hook: offered.voice.asked, requests: asked.length };
  await openTalk(page, world, giver, { notes });
  const shown = await until(page, (s) => s.talk?.npc === giver && s.talk.typed && !s.talk.waiting, `${giver}'s offer shown whole`);
  if (shown.talk.choices.length === 0) {
    notes.push(`${giver}'s first line has no choices, so choices were not read`);
    await talkThrough(page);
    return;
  }
  const clips = lineAndChoiceClips(language, shown.talk);
  expect(clips.length === shown.talk.choices.length + 1, `"${shown.talk.line}" and its choices have ${clips.length} clips in ${language}, not ${shown.talk.choices.length + 1}`);
  const read = await until(page, (s) => s.voice.asked >= before.hook + clips.length, `the line and its ${shown.talk.choices.length} choices to be read`, 10_000).catch(() => readState(page));
  expect(read.voice.asked === before.hook + clips.length && read.voice.clip === clips.at(-1), `with "Read to me" on, ${giver}'s offer asked for ${read.voice.asked - before.hook} clips ending ${read.voice.clip}, not ${clips.length} ending ${clips.at(-1)}`);
  expect(inOrder(asked.slice(before.requests), clips), `with "Read to me" on, the line and choices requested ${JSON.stringify(asked.slice(before.requests))}, not ${JSON.stringify(clips)} in order`);
  const looks = await choiceLooks(page, shown.talk.choices.length);
  expect(looks.length === shown.talk.choices.length && looks.every((look) => look.picture !== null), `a choice shows no picture: ${JSON.stringify(looks)}`);
  await nextFrames(page);
  await check('the choices with their pictures', 'v5-choices');
  const again = { hook: read.voice.asked, requests: asked.length };
  await page.locator('#talk .talk-speaker').tap();
  const replayed = await until(page, (s) => s.voice.asked >= again.hook + clips.length, "the talk box's speaker button to read the line and its choices", 10_000).catch(() => readState(page));
  expect(replayed.voice.asked === again.hook + clips.length && replayed.voice.clip === clips.at(-1), `the speaker button asked for ${replayed.voice.asked - again.hook} clips ending ${replayed.voice.clip}, not ${clips.length} ending ${clips.at(-1)}`);
  await until(page, () => inOrder(asked.slice(again.requests), clips), 'the clip requests', 5_000).catch(() => {});
  expect(inOrder(asked.slice(again.requests), clips), `the speaker button requested ${JSON.stringify(asked.slice(again.requests))}, not ${JSON.stringify(clips)} in order`);
  expect(replayed.talk?.node === shown.talk.node, `the speaker button moved the talk on from ${shown.talk.node} to ${replayed.talk?.node}`);
  const later = shown.talk.choices.find((choice) => choice.kind === 'declines');
  if (!later) {
    notes.push(`${giver}'s offer has no choice that puts it off`);
    await talkThrough(page);
    return;
  }
  await page.locator(`#talk .talk-choice[data-choice="${later.index}"]`).tap();
  await until(page, (s) => s.talk === null || s.talk.node !== shown.talk.node, `${giver}'s talk to go on from the offer`);
  await talkThrough(page);
}
/** Off: a line asks for nothing by itself, the speaker button asks for its clip, and closing the talk asks for nothing more. */
async function offTalk(page, world, plan, { language, asked, expect, notes }) {
  await openTalk(page, world, plan.handover, { notes });
  const { state, clip } = await firstLine(page, plan.handover, language);
  const before = { hook: state.voice.asked, requests: asked.length };
  await page.waitForTimeout(300);
  const quiet = await readState(page);
  expect(quiet.voice.asked === before.hook && asked.length === before.requests, `with "Read to me" off, "${state.talk.line}" asked for ${quiet.voice.clip}`);
  if (await speakerShown(page, clip, 'with "Read to me" off', expect)) {
    await page.locator('#talk .talk-speaker').tap();
    const after = await until(page, (s) => s.voice.asked === before.hook + 1, 'the speaker button to ask for the line', 5_000);
    expect(after.voice.clip === clip, `the speaker button asked for ${after.voice.clip}, not ${clip} for "${state.talk.line}"`);
    expect(after.talk?.node === state.talk.node, `the speaker button moved the talk on from ${state.talk.node} to ${after.talk?.node}`);
    await until(page, () => asked.length === before.requests + 1, 'the clip request', 5_000).catch(() => {});
    expect(asked.at(-1) === clip, `the speaker button requested ${JSON.stringify(asked.slice(before.requests))}, not ${clip}`);
  } else notes.push(`${plan.handover}'s reminder has no clip in ${language}, so the talk box's speaker button was not tapped`);
  const tapped = (await readState(page)).voice.asked;
  await page.locator('#talk .talk-close').tap();
  const closed = await until(page, (s) => s.talk === null, 'the talk to close');
  expect(closed.voice.asked === tapped, 'closing the talk asked for a clip');
}

/**
 * Plays "Read to me" from the world, signed in as the prepared story player (`plan` is storySave's
 * plan, with a delivery to hand over). `asked` is silenceClips' list. `reload` reloads the page
 * back into the world. Every clip asked for must be served by the game's own server.
 */
export async function playVoice(page, world, plan, { language, asked, base, expect, check, notes, reload }) {
  if (!plan.handover) {
    notes.push('no quest has a delivery before resting at a shrine on this map, so "Read to me" was not played');
    return;
  }
  const start = await until(page, (s) => inWorld(s) && s.voice.readToMe !== null, "the world with the player's settings");
  expect(start.voice.readToMe === false, `a new player has "Read to me" ${start.voice.readToMe}, not off`);
  await setReadToMe(page, true, { expect, check, shots: ['v1-settings-off', 'v2-settings-on'] });
  await reload();
  const back = await until(page, (s) => inWorld(s) && s.voice.readToMe !== null, 'the world after a reload');
  expect(back.voice.readToMe === true, '"Read to me" was not saved with the player: off after a reload');
  await onTalk(page, world, plan, { language, asked, expect, check, notes });
  await choicesTalk(page, world, { language, asked, expect, check, notes });
  await setReadToMe(page, false, { expect, check });
  await offTalk(page, world, plan, { language, asked, expect, notes });
  expect(asked.length > 0, 'no clip was ever requested');
  await inTurn([...new Set(asked)], async (path) => {
    const response = await fetch(`${base}${path}`);
    await response.arrayBuffer();
    expect(response.status === 200 && response.headers.get('content-type') === 'audio/mpeg', `the server answers ${path} with ${response.status} ${response.headers.get('content-type')}`);
  });
}
