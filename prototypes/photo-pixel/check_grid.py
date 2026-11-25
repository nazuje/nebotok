"""How many squares of the synthetic grid photo were read back as the colour that was painted."""
import json
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
truth = json.load(open(REPO / 'content/art/couriers/courier.json'))['frames']['down-stand']
got = json.load(open('out-synth/grid16-courier.json'))['frames']['down-stand']
pairs = {}
for tr, gr in zip(truth, got):
    for a, b in zip(tr, gr):
        pairs.setdefault(a, {}).setdefault(b, 0)
        pairs[a][b] += 1
print(json.dumps(pairs))
# a cell is right when every painted key maps to one read key consistently
best = {a: max(m, key=m.get) for a, m in pairs.items()}
right = sum(m[best[a]] for a, m in pairs.items())
print('cells consistent with the painting:', right, 'of 256')
print(json.load(open('out-synth/grid16-courier.json'))['palette'])
