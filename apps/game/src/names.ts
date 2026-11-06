import type { NameLabel } from './world-scene.ts';

/** A placed tag, in CSS pixels from the page's top left. */
export type TagBox = { readonly id: string; readonly name: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type NameTags = {
  place(labels: readonly NameLabel[]): void;
  /** Where each tag was last placed. */
  boxes(): readonly TagBox[];
};

/** Space kept between two stacked tags, in CSS pixels. */
export const TAG_GAP = 2;

type Wanted = { readonly id: string; readonly name: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const overlaps = (a: TagBox, b: TagBox) => a.x < b.x + b.width + TAG_GAP && b.x < a.x + a.width + TAG_GAP && a.y < b.y + b.height + TAG_GAP && b.y < a.y + a.height + TAG_GAP;

/**
 * Lays tags out so none covers another. Each wants to sit centred on `x` with its bottom on `y`;
 * the lowest on the page keeps its spot, and each one above it that would overlap a placed tag
 * moves up just past it. Ties go by id, so the order holds still from frame to frame.
 */
export function stackTags(wanted: readonly Wanted[]): TagBox[] {
  const order = wanted.toSorted((a, b) => b.y - a.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: TagBox[] = [];
  for (const tag of order) {
    const box = { id: tag.id, name: tag.name, x: tag.x - tag.width / 2, y: tag.y - tag.height, width: tag.width, height: tag.height };
    // A tag only ever moves up past the tag it hit, so this ends within placed.length moves.
    for (let blocker = placed.find((other) => overlaps(box, other)); blocker; blocker = placed.find((other) => overlaps(box, other))) {
      box.y = blocker.y - TAG_GAP - box.height;
    }
    placed.push(box);
  }
  return placed;
}

/** Other players' names, as HTML over the canvas so they stay sharp and readable at any zoom. */
export function createNameTags(root: HTMLElement): NameTags {
  const tags = new Map<string, HTMLSpanElement>();
  let boxes: TagBox[] = [];
  return {
    place: (labels) => {
      const seen = new Set<string>();
      for (const label of labels) {
        seen.add(label.id);
        let tag = tags.get(label.id);
        if (!tag) {
          tag = document.createElement('span');
          tag.className = 'name-tag';
          root.append(tag);
          tags.set(label.id, tag);
        }
        if (tag.textContent !== label.name) tag.textContent = label.name;
        tag.classList.toggle('away', label.away);
        tag.classList.toggle('battling', label.battling);
        tag.classList.toggle('talking', label.talking && !label.battling);
      }
      for (const [id, tag] of tags) {
        if (seen.has(id)) continue;
        tag.remove();
        tags.delete(id);
      }
      // Every size is read before any tag moves, so the page lays out once a frame.
      const wanted = labels.flatMap((label) => {
        const tag = tags.get(label.id);
        return tag ? [{ id: label.id, name: label.name, x: label.x, y: label.y, width: tag.offsetWidth, height: tag.offsetHeight }] : [];
      });
      boxes = stackTags(wanted);
      for (const box of boxes) {
        const tag = tags.get(box.id);
        if (tag) tag.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      }
    },
    boxes: () => boxes,
  };
}
