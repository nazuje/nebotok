import { describe, expect, it } from 'vitest';
import { TAG_GAP, stackTags } from '../src/names.ts';

const tag = (id: string, x: number, y: number, width = 40, height = 20) => ({ id, name: id, x, y, width, height });
const clear = (boxes: ReturnType<typeof stackTags>) =>
  boxes.every((a, i) => boxes.every((b, j) => i === j || a.x + a.width + TAG_GAP <= b.x || b.x + b.width + TAG_GAP <= a.x || a.y + a.height + TAG_GAP <= b.y || b.y + b.height + TAG_GAP <= a.y));

describe('name tags over couriers', () => {
  it('sits a lone tag centred above its spot', () => {
    expect(stackTags([tag('a', 100, 200)])).toEqual([{ id: 'a', name: 'a', x: 80, y: 180, width: 40, height: 20 }]);
  });

  it('stacks the tags of couriers on one tile instead of drawing them over each other', () => {
    const boxes = stackTags([tag('b', 100, 200, 90), tag('a', 100, 200, 50), tag('c', 100, 200, 60)]);
    expect(boxes.map((box) => [box.id, box.y])).toEqual([['a', 180], ['b', 180 - 20 - TAG_GAP], ['c', 180 - 2 * (20 + TAG_GAP)]]);
    expect(clear(boxes)).toBe(true);
  });

  it('lifts a tag that would overlap a neighbour a little lower on the page, and leaves tags apart alone', () => {
    const boxes = stackTags([tag('near', 120, 196), tag('low', 100, 200), tag('far', 300, 200)]);
    expect(boxes.find((box) => box.id === 'low')?.y).toBe(180);
    expect(boxes.find((box) => box.id === 'far')?.y).toBe(180);
    expect(boxes.find((box) => box.id === 'near')?.y).toBe(180 - 20 - TAG_GAP);
    expect(clear(boxes)).toBe(true);
  });

  it('keeps every tag clear of every other however many crowd together', () => {
    const crowd = Array.from({ length: 12 }, (_, at) => tag(`p${at}`, 100 + (at % 4) * 15, 200 + Math.floor(at / 4) * 6, 40 + at * 3));
    expect(clear(stackTags(crowd))).toBe(true);
  });
});
