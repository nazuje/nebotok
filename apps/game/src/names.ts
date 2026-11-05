import type { NameLabel } from './world-scene.ts';

export type NameTags = { place(labels: readonly NameLabel[]): void };

/** Other players' names, as HTML over the canvas so they stay sharp and readable at any zoom. */
export function createNameTags(root: HTMLElement): NameTags {
  const tags = new Map<string, HTMLSpanElement>();
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
        tag.style.transform = `translate(${Math.round(label.x)}px, ${Math.round(label.y)}px) translate(-50%, -100%)`;
      }
      for (const [id, tag] of tags) {
        if (seen.has(id)) continue;
        tag.remove();
        tags.delete(id);
      }
    },
  };
}
