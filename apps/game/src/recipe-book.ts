import { giveItems, itemCount, recipeBook, recipeSkill, spriteFor, type Language, type Progress, type StoryContent, type StringId } from '@nebotok/core';
import { itemIcon } from './bag-screen.ts';
import { CONTENT, itemName } from './battle-content.ts';
import { button, el } from './dom.ts';
import { closeButton, pictureIcon, spriteIcon } from './pictures.ts';
import { STORY } from './story-content.ts';
import { format, text } from './strings.ts';

/** A dish shows a star for each this much `strength`, at least one and at most MAX_STARS. */
export const STRENGTH_PER_STAR = 5;
export const MAX_STARS = 5;

export const recipeStars = (strength: number): number => Math.min(MAX_STARS, Math.max(1, Math.ceil(strength / STRENGTH_PER_STAR)));

/** Why a recipe cannot be cooked now: ingredients missing, or no room for the dish. */
export type CookBlock = 'noItem' | 'bagFull';

export type RecipeRow = {
  readonly recipe: string;
  readonly makes: string;
  readonly stars: number;
  readonly ingredients: readonly { readonly item: string; readonly have: number; readonly need: number }[];
  readonly blocked: CookBlock | null;
};

/** The recipe book as the pot shows it: each recipe the cooking level unlocks, and the next locked one. */
export type RecipePage = { readonly skill: string | null; readonly rows: readonly RecipeRow[]; readonly next: { readonly recipe: string; readonly makes: string; readonly level: number } | null };

/** The rows of the recipe book (core `recipeBook`), with what the bag has of each ingredient and whether Cook works. */
export function recipePage(progress: Progress, content: StoryContent): RecipePage {
  const recipes = content.skills?.recipes;
  const book = recipeBook(progress, content);
  const rows = book.unlocked.flatMap((id) => {
    const recipe = recipes?.get(id);
    if (!recipe) return [];
    const ingredients = recipe.ingredients.map(({ item, count }) => ({ item, have: itemCount(progress, item), need: count }));
    const full = giveItems(progress, [{ item: recipe.makes, count: 1 }], content).given.length === 0;
    const blocked: CookBlock | null = ingredients.some(({ have, need }) => have < need) ? 'noItem' : full ? 'bagFull' : null;
    const dish = CONTENT.items.get(recipe.makes);
    const strength = dish?.kind === 'treat' ? (dish.strength ?? 0) : 0;
    return [{ recipe: id, makes: recipe.makes, stars: recipeStars(strength), ingredients, blocked }];
  });
  const locked = book.next ? recipes?.get(book.next.recipe) : undefined;
  const skill = content.skills ? (recipeSkill(content.skills)?.id ?? null) : null;
  return { skill, rows, next: locked && book.next ? { recipe: locked.id, makes: locked.makes, level: book.next.level } : null };
}

const BLOCK_TEXT: Readonly<Record<CookBlock, StringId>> = { noItem: 'skill.noItem', bagFull: 'skill.bagFull' };

/** An ingredient's pips: one per item the recipe needs, filled for each the bag has. */
export const needPips = (have: number, need: number): boolean[] => Array.from({ length: need }, (_, at) => at < have);

/** An ingredient as its picture with a pip for each one needed, filled for each the bag has, red while short; the words are for screen readers. */
function ingredient({ item, have, need }: RecipeRow['ingredients'][number], language: Language): HTMLElement {
  const pips = needPips(have, need).map((filled) => el('span', { className: filled ? 'pip' : 'pip empty' }));
  return el('li', { className: have < need ? 'recipe-need short' : 'recipe-need' }, [
    el('span', { className: 'visually-hidden', text: format('book.have', language, { item: itemName(item, language), count: have, of: need }) }),
    el('span', { className: 'recipe-need-pictures', attrs: { 'aria-hidden': 'true' } }, [spriteIcon(spriteFor.item(item), 32), el('span', { className: 'recipe-pips' }, pips)]),
  ]);
}

/** Why Cook is off, with the full bag's picture when the dish has no room. */
function blockedWhy(blocked: CookBlock, makes: string, language: Language): HTMLElement {
  const words = el('span', { text: format(BLOCK_TEXT[blocked], language, { item: itemName(makes, language) }) });
  return el('p', { className: 'recipe-why' }, blocked === 'bagFull' ? [pictureIcon('bag-full', 32), words] : [words]);
}

/** A dish's strength as stars, read out as "Strength 2 of 5". */
function stars(count: number, language: Language): HTMLElement {
  const marks = Array.from({ length: MAX_STARS }, (_, at) => el('span', { className: at < count ? 'star' : 'star empty' }));
  return el('span', { className: 'recipe-stars', attrs: { role: 'img', 'aria-label': format('book.strength', language, { count }) } }, marks);
}

/** The next locked recipe: its dish greyed out, then a lock, the skill's icon and the level it needs, with the words under them. */
function lockedRow(next: NonNullable<RecipePage['next']>, skill: string | null, language: Language): HTMLElement {
  const skillName = (skill && STORY.skills?.skills.get(skill)?.name[language]) ?? '';
  const pictures = el('div', { className: 'recipe-lock', attrs: { 'aria-hidden': 'true' } }, [
    pictureIcon('lock', 32),
    ...(skill ? [spriteIcon(spriteFor.skill(skill), 32)] : []),
    el('span', { className: 'level-badge', text: String(next.level) }),
  ]);
  return el('li', { className: 'recipe locked', attrs: { 'data-recipe': next.recipe } }, [
    el('div', { className: 'recipe-top' }, [itemIcon(next.makes), el('div', { className: 'recipe-name' }, [el('span', { text: itemName(next.makes, language) })])]),
    pictures,
    el('p', { className: 'recipe-why', text: format('book.locked', language, { skill: skillName, level: next.level }) }),
  ]);
}

/** Cook, with the picture of the pot it is cooked in. */
function cookButton(station: string, language: Language, onTap: () => void): HTMLButtonElement {
  const cook = button('primary recipe-cook', '', onTap);
  const look = STORY.skills?.stations.get(station)?.look;
  cook.append(...(look ? [spriteIcon(spriteFor.station(look), 32)] : []), el('span', { text: text('book.cook', language) }));
  return cook;
}

export type RecipeBookOptions = {
  language(): Language;
  /** The player's bag and skills, or null before the server has sent them. */
  progress(): Progress | null;
  /** Cook was tapped. */
  cook(recipe: string, station: string): void;
  /** The player closed the book. */
  closed(): void;
};

export type TestRecipeBook = { readonly station: string; readonly rows: readonly { readonly recipe: string; readonly blocked: CookBlock | null }[]; readonly next: string | null };

export type RecipeBookScreen = {
  open(station: string): void;
  close(): void;
  isOpen(): boolean;
  /** Moves focus to the first Cook that works, or the book itself, as opening it does. */
  focus(): void;
  /** Draws the latest book, rebuilding only when it changed. */
  render(): void;
  state(): TestRecipeBook | null;
};

/**
 * The recipe book, opened by walking up to a cooking pot: each recipe the cooking level unlocks with
 * its dish, the dish's strength as stars and each ingredient as its picture with a pip for each one
 * needed, filled for each the bag has. Cook shows the pot, and is off, with the reason under it, while
 * an ingredient is short (its pips red) or the dish's stack is full (the full bag). The next locked
 * recipe shows a lock, the skill's icon and the level it needs. Opening it moves focus to the first Cook that
 * works, or the book itself; Escape closes it, and closing gives focus back to where it was.
 */
export function createRecipeBook(root: HTMLElement, options: RecipeBookOptions): RecipeBookScreen {
  let station: string | null = null;
  let shown = '';
  let page: RecipePage | null = null;
  let focusBefore: HTMLElement | null = null;
  root.tabIndex = -1;

  function row(entry: RecipeRow, at: string, language: Language): HTMLElement {
    const lines = entry.ingredients.map((each) => ingredient(each, language));
    const cook = cookButton(at, language, () => options.cook(entry.recipe, at));
    cook.disabled = entry.blocked !== null;
    const parts: HTMLElement[] = [
      el('div', { className: 'recipe-top' }, [itemIcon(entry.makes), el('div', { className: 'recipe-name' }, [el('span', { text: itemName(entry.makes, language) }), stars(entry.stars, language)])]),
      el('ul', { className: 'recipe-needs' }, lines),
      cook,
    ];
    if (entry.blocked) parts.push(blockedWhy(entry.blocked, entry.makes, language));
    return el('li', { className: 'recipe', attrs: { 'data-recipe': entry.recipe } }, parts);
  }

  function build(at: string, current: RecipePage) {
    const language = options.language();
    const list = current.rows.map((entry) => row(entry, at, language));
    if (current.next) list.push(lockedRow(current.next, current.skill, language));
    const before = root.querySelector<HTMLElement>('.team-scroll');
    const keepScroll = before?.scrollTop ?? 0;
    const keepFocus = focusedControl();
    const scroll = el('div', { className: 'team-scroll', attrs: { role: 'group' } }, [el('ul', { className: 'recipe-list' }, list)]);
    const foot = el('div', { className: 'team-foot' }, [
      closeButton('primary book-close', text('team.close', language), () => {
        close();
        options.closed();
      }),
    ]);
    root.replaceChildren(el('div', { className: 'screen-body team-body' }, [el('div', { className: 'team-head' }, [el('h2', { className: 'screen-title', text: text('book.title', language) })]), scroll, foot]));
    scroll.scrollTop = keepScroll;
    if (keepFocus) (root.querySelector<HTMLElement>(keepFocus) ?? root).focus({ preventScroll: true });
  }

  /** A selector for the control in the book that has focus, so a rebuilt book can give it back. */
  function focusedControl(): string | null {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !root.contains(focused)) return null;
    if (focused.classList.contains('book-close')) return '.book-close';
    const recipe = focused.closest<HTMLElement>('.recipe')?.dataset['recipe'];
    return recipe !== undefined && focused.classList.contains('recipe-cook') ? `.recipe[data-recipe="${recipe}"] .recipe-cook:not(:disabled)` : '.recipe-cook:not(:disabled)';
  }

  function render(force = false) {
    root.hidden = station === null;
    const progress = options.progress();
    if (station === null || !progress) return;
    page = recipePage(progress, STORY);
    const key = JSON.stringify([options.language(), station, page]);
    if (!force && key === shown) return;
    shown = key;
    build(station, page);
  }

  function focusFirst() {
    (root.querySelector<HTMLElement>('.recipe-cook:not(:disabled)') ?? root).focus({ preventScroll: true });
  }

  function close() {
    const focused = document.activeElement;
    const hadFocus = station !== null && focused instanceof HTMLElement && root.contains(focused);
    station = null;
    page = null;
    shown = '';
    render();
    // A hidden button keeps focus until the next frame, and the body cannot take it back by focus().
    if (hadFocus) focused.blur();
    if (hadFocus && focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
    focusBefore = null;
  }

  window.addEventListener('keydown', (event) => {
    // A tiny game opened from the book takes Escape first and calls preventDefault.
    if (station === null || event.code !== 'Escape' || event.repeat || event.defaultPrevented) return;
    event.preventDefault();
    close();
    options.closed();
  });

  return {
    open: (at) => {
      const focused = document.activeElement;
      if (station === null) focusBefore = focused instanceof HTMLElement && !root.contains(focused) ? focused : null;
      station = at;
      render(true);
      focusFirst();
    },
    close,
    isOpen: () => station !== null,
    focus: () => {
      if (station !== null) focusFirst();
    },
    render: () => render(),
    state: () => (station === null ? null : { station, rows: (page?.rows ?? []).map(({ recipe, blocked }) => ({ recipe, blocked })), next: page?.next?.recipe ?? null }),
  };
}
