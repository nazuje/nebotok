#!/bin/sh
# Once per machine: the voice tool's Python environment and its two voice models. They live outside
# the repository, in $NEBOTOK_VOICE_HOME (default ~/.cache/nebotok-voice), so every worktree shares
# one install and none of it can be committed. docs/security.md lists what this downloads.
set -eu
cd "$(dirname "$0")"
VOICE_HOME="${NEBOTOK_VOICE_HOME:-$HOME/.cache/nebotok-voice}"

# Pinned to one upload of the voices, so everyone generates from the same models.
REVISION=5041a7a49ae5b3a0f30e6837769eb03fdbb231bd
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/$REVISION"

need() {
  command -v "$1" >/dev/null || { echo "Missing $1. Install it with: brew install $2" >&2; exit 1; }
}
need uv uv
need ffmpeg ffmpeg
need espeak-ng espeak-ng

uv venv --python 3.12 --allow-existing "$VOICE_HOME/venv"
# Hash-checked wheels only: nothing is built from source, so no package runs its own setup code.
uv pip install --python "$VOICE_HOME/venv/bin/python" --require-hashes --only-binary :all: -r requirements.txt

mkdir -p "$VOICE_HOME/models"
for path in \
  en/en_GB/cori/medium/en_GB-cori-medium.onnx \
  en/en_GB/cori/medium/en_GB-cori-medium.onnx.json \
  sl/sl_SI/artur/medium/sl_SI-artur-medium.onnx \
  sl/sl_SI/artur/medium/sl_SI-artur-medium.onnx.json; do
  file="$VOICE_HOME/models/$(basename "$path")"
  if [ ! -f "$file" ]; then
    curl -fL --proto =https --progress-bar -o "$file.partial" "$BASE/$path"
    mv "$file.partial" "$file"
  fi
done

# A cut-off or swapped download fails here, not later in a confusing way.
(cd "$VOICE_HOME/models" && shasum -a 256 -c <<'SUMS'
1899f98e5fb8310154f3c2973f4b8a929ba7245e722b3d3a85680b833d95f10d  en_GB-cori-medium.onnx
e262c16d7f192f69d4edd6b4ef8a5915379e67495fcc402f1ab15eeb33da3d36  en_GB-cori-medium.onnx.json
9222ed93ef425524ad4be0b083369af8ea8db18455576a6016b154192f4ed38c  sl_SI-artur-medium.onnx
741283430f1fa2be5c61717c6f1fe795a7b9f537491927340dd12f90f3b3cc04  sl_SI-artur-medium.onnx.json
SUMS
)
echo "Ready. Make the clips with: npm run voice"
