"""Turns IPA into WAV files with Piper. Reads {"model", "items": [{"ipa", "wav",
"length_scale"}]} on stdin. Fails on a sound the voice doesn't know, because Piper
would otherwise drop it silently and leave a clip with a hole in it."""

import json
import sys
import wave

import numpy as np
from piper import PiperVoice
from piper.voice import SynthesisConfig

job = json.load(sys.stdin)
voice = PiperVoice.load(job["model"])
known = voice.config.phoneme_id_map

for done, item in enumerate(job["items"], 1):
    ipa = item["ipa"]
    unknown = sorted({sound for sound in ipa if sound not in known})
    if unknown:
        sys.exit(f"The voice has no sound for {unknown} in: {ipa}")

    config = SynthesisConfig(length_scale=item["length_scale"])
    audio = voice.phoneme_ids_to_audio(voice.phonemes_to_ids(list(ipa)), config)
    if isinstance(audio, tuple):
        audio = audio[0]
    pcm = (np.clip(np.asarray(audio), -1, 1) * 32767).astype("int16").tobytes()

    with wave.open(item["wav"], "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(voice.config.sample_rate)
        out.writeframes(pcm)
    print(f"  {done}/{len(job['items'])}", file=sys.stderr)
