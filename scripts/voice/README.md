# Voice tool

Makes the computer-voice clips the game plays for talk lines, choices, quest text and move names, in English
and Slovenian, ahead of time with [Piper](https://github.com/OHF-Voice/piper1-gpl). Ported from the
owner's Playroom project. The clips are committed and served by the game's own server, so the
game, CI and the image need none of this: it runs only on a developer's Mac.

## Setup

Once per machine. You need [uv](https://docs.astral.sh/uv/), ffmpeg and espeak-ng:

```sh
brew install uv ffmpeg espeak-ng
npm run voice:setup
```

This makes a Python 3.12 environment from the pinned, hash-checked `requirements.txt` and
downloads the two voice models (about 63 MB each), checking their checksums. Both go in
`~/.cache/nebotok-voice/` (or `$NEBOTOK_VOICE_HOME`), outside the repository, so every worktree
shares one install and none of it can be committed. `docs/security.md` lists exactly what is
downloaded and from where.

## Commands

```sh
npm run voice                         # make missing clips, remove unused ones, rewrite the manifest
npm run voice:words                   # every word and its sounds, for a person to scan
npm run voice:words -- sl             # one language
npm run voice:fix -- sl tukaj tˈuːkaj # add or change a fix, then make the clips again
```

`npm run voice` is safe to run any time. Run it after changing any line players hear, and commit
the clips with the manifest. `npm run content:validate` fails until you do.

## What goes in and comes out

In: every dialogue node's `say` and every choice in `content/dialogue/*.json`, every quest's
`name`, `summary` and step `hint` in `content/quests.json`, and every move's `name` in
`content/creatures/moves.json` (read by the loadout picker's speaker buttons), in both languages
(`lines.mjs`). A
Slovenian text written as forms for boys and girls gets a clip for each form. Lines with a
`{placeholder}` are filled in while playing, so they are not voiced; `npm run voice` lists them.

Out:

- `apps/game/public/voice/<language>/<hash>.mp3`: Vite copies these into the build, and the game
  serves them from its own origin as `/voice/<language>/<hash>.mp3`.
- `apps/game/src/voice-clips.json`: the manifest, from language, then voice, then the exact line,
  to its file. It lives in `src/` so the game bundles it. `voiceClip(language, voice, text)` in
  `apps/game/src/voice-clips.ts` looks a line up.

A clip's name is a hash of the exact line, its language, the pronunciation fixes it uses and every
voice setting (`clipFile` in `lib.mjs`). So a changed line, fix or setting gets a new clip, and
`content:validate` (`clips.mjs`) can work out every name without Python and fail on a missing or
stale clip. CI only checks; it never makes clips.

## Voices

`config.mjs` holds every setting. English is Piper's British `cori` voice, Slovenian its `artur`
voice. The narrator, choices, quest text and move names use the voice as it is. Each character's
`voice.pitch` (1 to 5) in `content/npcs.json` moves the pitch by 1.5 semitones a step from the
middle, without changing speed, and `voice.pace` (1 to 3) makes it slower or quicker. Characters
with the same pitch and pace share clips.

Audio processing follows Playroom's, tuned by ear there: silence trimmed from both ends at -45 dB,
`loudnorm=I=-16:TP=-1.5`, then 22050 Hz mono MP3, at 48 kbps here to keep the image small.

## Fixing pronunciation

espeak gets some words wrong, Slovenian stress most of all, and English reads the characters'
Slovenian names as English. Run `npm run voice:words` and scan the list: Slovenian words show their
stressed vowel in capitals (`tUkaj`), then the IPA used, and fixed words say `(fixed)`.

`pronunciation/<language>.json` maps a written word to its IPA. A fix applies to that whole word in
any capitalization, never to part of a longer word, and each grammatical form is its own word. To
write one, copy what espeak produced and move the stress mark `ˈ` to just before the stressed vowel;
long vowels carry `ː`. `pronunciation/sl.json` started as a copy of Playroom's table. A sound the
voice doesn't know stops the run with an error rather than leaving a gap in the clip.

## Why the pipeline goes through Homebrew's espeak-ng

Piper normally turns text into sounds itself, with a bundled copy of espeak-ng. On macOS that
copy is broken: it looks for its data at a path on the machine that built it. So `phonemize.py`
calls Homebrew's espeak-ng through `phonemizer-fork`, and `synth.py` uses Piper only to turn those
sounds into audio. The library is expected at `/opt/homebrew/lib/libespeak-ng.dylib`; set
`ESPEAK_LIBRARY` if yours is elsewhere.

## Files

| File | What it does |
| --- | --- |
| `voice.mjs` | The commands: plans the work, runs Python and ffmpeg, writes clips and the manifest |
| `clips.mjs` | The clips the game should have, and how the committed ones differ; content:validate uses it |
| `lines.mjs` | The lines players hear, from `content/` |
| `lib.mjs` | The decisions, as plain functions; `lib.test.mjs` and `clips.test.mjs` test them |
| `config.mjs` | Voices, speeds, pitches and audio settings |
| `pronunciation/` | Word fixes, one table per language |
| `phonemize.py` | Text to IPA, through espeak-ng |
| `synth.py` | IPA to WAV, through Piper |
| `setup.sh`, `requirements.in`, `requirements.txt`, `models.sha256` | One-time setup, the pinned Python packages and the models' checksums |

## Credit

Voices: [Piper](https://github.com/rhasspy/piper-voices) "cori" (`en_GB-cori-medium`), trained on
LibriVox recordings, public domain; and "artur" (`sl_SI-artur-medium`), trained on the
[Artur dataset](https://huggingface.co/datasets/ppisljar/artur_studio_tts/) by ppisljar,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
