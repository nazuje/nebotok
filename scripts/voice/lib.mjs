// The voice tool's decisions, as plain functions with no Python and no files, so the unit tests and
// content:validate can use them on any machine.
import { createHash } from 'node:crypto';
import { AUDIO_FILTER, MP3_ARGS, NARRATOR_VOICE, PACE_SCALE, PITCH_SEMITONES, SAMPLE_RATE, VOICES } from './config.mjs';

const WORD = /[\p{L}\p{M}]+/gu;
const PLACEHOLDER = /\{[^{}]*\}/;

/** A line with a `{placeholder}` is filled in while playing, so no clip can be made ahead for it. */
export const hasPlaceholder = (text) => PLACEHOLDER.test(text);

function fixKey(word) {
  return word.normalize('NFC').toLocaleLowerCase('sl');
}

/** Every distinct word in the lines, lower case, in Slovenian alphabetical order. */
export function uniqueWords(lines) {
  const words = new Set(lines.flatMap((line) => (line.match(WORD) ?? []).map(fixKey)));
  return [...words].toSorted((a, b) => a.localeCompare(b, 'sl'));
}

export function fixFor(word, fixes) {
  const key = fixKey(word);
  return Object.hasOwn(fixes, key) ? fixes[key] : undefined;
}

/**
 * What the voice reads aloud: the line without quotation marks, which neither voice has a sound
 * for, and with plain apostrophes and dots.
 */
export function spokenText(text) {
  return text
    .replace(/[»«„“”"]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuts a line around the words that have a fix: [{ text }, { ipa }, { text }].
 * The fix can't be applied to espeak's output afterward, because espeak merges
 * small words ("v hiši" comes back as one word), and a word that is only part of
 * a longer one must stay untouched.
 */
export function splitLine(line, fixes) {
  const parts = [];
  let done = 0;
  for (const match of line.matchAll(WORD)) {
    const ipa = fixFor(match[0], fixes);
    if (ipa === undefined) continue;
    if (match.index > done) parts.push({ text: line.slice(done, match.index) });
    parts.push({ ipa });
    done = match.index + match[0].length;
  }
  if (done < line.length) parts.push({ text: line.slice(done) });
  return parts;
}

/** The pieces of a split line that espeak has to read. */
export function chunksIn(parts) {
  return parts.flatMap(({ text }) => (text?.trim() ? [text.trim()] : []));
}

/** Puts a split line back together as IPA, keeping the source's spaces around each fixed word. */
export function joinParts(parts, ipaFor) {
  const pieces = parts.map(({ ipa, text }) => {
    if (ipa !== undefined) return ipa;
    const inner = text.trim() ? ipaFor(text.trim()) : '';
    return text.replace(text.trim() || ' ', () => inner || ' ');
  });
  return pieces.join('').replace(/\s+/g, ' ').trim();
}

/** The fixes a line uses, as sorted [word, ipa] pairs, so a new or changed fix renames only the clips it changes. */
export function fixesUsed(line, fixes) {
  const used = new Map((line.match(WORD) ?? []).flatMap((word) => {
    const ipa = fixFor(word, fixes);
    return ipa === undefined ? [] : [[fixKey(word), ipa]];
  }));
  return [...used].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The manifest's name for a voice: `narrator`, or the character's pitch and pace. */
export const voiceKey = (voice) => (voice === null ? 'narrator' : `pitch${voice.pitch}-pace${voice.pace}`);

const rounded = (value) => Math.round(value * 10_000) / 10_000;

/** The ffmpeg filter that moves a clip's pitch by `semitones` and keeps its speed, then evens it out. */
export function audioFilter(semitones) {
  if (semitones === 0) return AUDIO_FILTER;
  const rate = Math.round(SAMPLE_RATE * 2 ** (semitones / 12));
  return `asetrate=${rate},aresample=${SAMPLE_RATE},atempo=${rounded(SAMPLE_RATE / rate)},${AUDIO_FILTER}`;
}

/** How one language's voice says a character's lines (`voice` null for the narrator). */
export function voiceSettings(language, voice) {
  const { pitch, pace } = voice ?? NARRATOR_VOICE;
  const { model, espeak, lengthScale } = VOICES[language];
  return { model, espeak, lengthScale: rounded(lengthScale * PACE_SCALE[pace]), filter: audioFilter(PITCH_SEMITONES[pitch]), mp3Args: MP3_ARGS };
}

/**
 * A clip's file name: a hash of the exact line, its language, the pronunciation fixes it uses and
 * every voice setting. So a changed line, fix or setting gets a new clip, and content:validate can
 * check every name without the voice tool.
 */
export function clipFile({ language, text, fixes, model, espeak, lengthScale, filter, mp3Args }) {
  const settings = JSON.stringify([language, text, fixes, model, espeak, lengthScale, filter, mp3Args]);
  return `${createHash('sha256').update(settings).digest('hex').slice(0, 16)}.mp3`;
}

function sortedObject(pairs) {
  return Object.fromEntries(pairs.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The manifest the game reads: language, then voice, then the exact line, to its file, in a steady order so diffs stay small. */
export function buildManifest(entries, languages) {
  return Object.fromEntries(
    languages.map((language) => {
      const own = entries.filter((entry) => entry.language === language);
      const voices = [...new Set(own.map((entry) => entry.voiceKey))].map((key) => [
        key,
        sortedObject(own.filter((entry) => entry.voiceKey === key).map(({ text, file }) => [text, file])),
      ]);
      return [language, sortedObject(voices)];
    }),
  );
}

/** Clips on disk that no line uses any more. */
export function staleClips(onDisk, entries) {
  const wanted = new Set(entries.map(({ file }) => file));
  return onDisk.filter((file) => file.endsWith('.mp3') && !wanted.has(file));
}

/** Pronunciations with one more fix, keyed the way lookups expect. */
export function addFix(fixes, word, ipa) {
  const words = word.match(WORD) ?? [];
  if (words.length !== 1 || words[0] !== word) throw new Error(`A fix is for one word, got: ${word}`);
  return sortedObject([...Object.entries(fixes), [fixKey(word), ipa]]);
}

const WRITTEN_VOWEL = /[aeiou]/gi;
const SOUNDED_VOWEL = /[aeiouɛɔəɐ]/g;
// "rdeč" has no written vowel before its r, though espeak sounds one.
const HIDDEN_VOWEL = /ə(?=r)/g;

/** Capitalizes the stressed vowel of a Slovenian word so a person can scan a list: tukaj becomes tukAj. */
export function markStress(word, ipa) {
  const stress = ipa.indexOf('ˈ');
  const vowels = word.match(WRITTEN_VOWEL)?.length ?? 0;
  if (stress < 0 || vowels < 2) return word;
  const before = ipa.slice(0, stress).replace(HIDDEN_VOWEL, '').match(SOUNDED_VOWEL)?.length ?? 0;
  let seen = -1;
  return word.replace(WRITTEN_VOWEL, (vowel) => {
    seen += 1;
    return seen === before ? vowel.toUpperCase() : vowel;
  });
}
