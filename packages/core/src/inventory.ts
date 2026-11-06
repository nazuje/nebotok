/**
 * The bag: how many of an item fit (`stackLimit`, by its kind in content/inventory.json), giving
 * items within those limits (`giveItems`), taking them (`takeItems`) and the bag as its screen
 * shows it (`bagView`). Items are never thrown away: a stack limit stops the bag overflowing.
 */
import type { Item, ItemKind } from './content.ts';
import { MAX_ITEM_COUNT, itemCount, type Progress } from './creatures.ts';
import type { InventoryFile } from './story-content.ts';

/** The most different items a bag holds, as the save allows. */
export const MAX_BAG_ENTRIES = 500;

/** What the bag rules read: every item by id, and inventory.json. */
export type BagRules = { readonly items: ReadonlyMap<string, Item>; readonly inventory: InventoryFile };

/** Some of one item. */
export type ItemCount = { readonly item: string; readonly count: number };

/** How many of an item fit in the bag: its kind's stack in inventory.json, at most 999. 0 for an item the content does not have. */
export function stackLimit(item: string, rules: BagRules): number {
  const kind = rules.items.get(item)?.kind;
  return kind ? Math.min(rules.inventory.kinds[kind].stack, MAX_ITEM_COUNT) : 0;
}

/** What `giveItems` did: the bag after, what went in, and what did not fit, each in the order given. */
export type Gift = { readonly progress: Progress; readonly given: readonly ItemCount[]; readonly extra: readonly ItemCount[] };

function addTo(list: ItemCount[], item: string, count: number): void {
  if (count <= 0) return;
  const at = list.findIndex((entry) => entry.item === item);
  if (at === -1) list.push({ item, count });
  else list[at] = { item, count: (list[at]?.count ?? 0) + count };
}

/**
 * Puts items in the bag, each up to its stack limit; the rest does not fit and is reported as
 * `extra`, never added. A bag already holding more than a limit (from before the limit) keeps
 * what it has. An item new to the bag needs a free place of the MAX_BAG_ENTRIES.
 */
export function giveItems(progress: Progress, gifts: readonly ItemCount[], rules: BagRules): Gift {
  let inventory = [...progress.inventory];
  const given: ItemCount[] = [];
  const extra: ItemCount[] = [];
  for (const { item, count } of gifts) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`giveItems() needs whole counts of at least 1, got ${count} of "${item}"`);
    const had = inventory.find((entry) => entry.item === item)?.count ?? 0;
    const room = had === 0 && inventory.length >= MAX_BAG_ENTRIES ? 0 : Math.max(stackLimit(item, rules) - had, 0);
    const fits = Math.min(count, room);
    if (fits > 0) {
      inventory = had === 0 ? [...inventory, { item, count: fits }] : inventory.map((entry) => (entry.item === item ? { item, count: had + fits } : entry));
    }
    addTo(given, item, fits);
    addTo(extra, item, count - fits);
  }
  return { progress: { ...progress, inventory }, given, extra };
}

/** Takes `count` of an item from the bag; null when the player has fewer. */
export function takeItems(progress: Progress, item: string, count: number): Progress | null {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`takeItems() needs a whole count of at least 1, got ${count}`);
  const had = itemCount(progress, item);
  if (had < count) return null;
  const inventory = had === count ? progress.inventory.filter((entry) => entry.item !== item) : progress.inventory.map((entry) => (entry.item === item ? { item, count: had - count } : entry));
  return { ...progress, inventory };
}

/** One stack in the bag: how many, and how many fit. */
export type BagEntry = { readonly item: string; readonly count: number; readonly limit: number };
/** The bag's items of one kind. */
export type BagSection = { readonly kind: ItemKind; readonly items: readonly BagEntry[] };

/**
 * The bag as its screen shows it: a section per kind, in inventory.json's `order`, each with the
 * player's items of that kind in items.json order. Items the content no longer has are left out.
 */
export function bagView(progress: Progress, rules: BagRules): BagSection[] {
  return rules.inventory.order.map((kind) => ({
    kind,
    items: [...rules.items.values()].flatMap((item) => {
      const count = item.kind === kind ? itemCount(progress, item.id) : 0;
      return count > 0 ? [{ item: item.id, count, limit: stackLimit(item.id, rules) }] : [];
    }),
  }));
}
