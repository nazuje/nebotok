import { giveItems, itemCount, recipeBook, recipeSkill, type Language, type Progress, type StoryContent, type StringId } from '@nebotok/core';
import { itemIcon } from './bag-screen.ts';
import { CONTENT, itemName } from './battle-content.ts';
import { button, el } from './dom.ts';
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

/** A dish's strength as stars, read out as "Strength 2 of 5". */
function stars(count: number, language: Language): HTMLElement {
  const marks = Array.from({ length: MAX_STARS }, (_, at) => el('span', { className: at < count ? 'star' : 'star empty' }));
  return el('span', { className: 'recipe-stars', attrs: { role: 'img', 'aria-label': format('book.strength', language, { count }) } }, marks);
}

/** The next locked recipe: its dish greyed out and the level it needs. */
function lockedRow(next: NonNullable<RecipePage['next']>, skill: string | null, language: Language): HTMLElement {
  const skillName = (skill && STORY.skills?.skills.get(skill)?.name[language]) ?? '';
  return el('li', { className: 'recipe locked', attrs: { 'data-recipe': next.recipe } }, [
    el('div', { className: 'recipe-top' }, [itemIcon(next.makes), el('div', { className: 'recipe-name' }, [el('span', { text: itemName(next.makes, language) })])]),
    el('p', { className: 'recipe-why', text: format('book.locked', language, { skill: skillName, level: next.level }) }),
  ]);
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
 * its dish, the dish's strength as stars and what the bag has of each ingredient ("Cloudberry 3 / 2").
 * Cook is off, with the reason under it, while an ingredient is short or the dish's stack is full.
 * The next locked recipe shows the level it needs. Opening it moves focus to the first Cook that
 * works, or the book itself; Escape closes it, and closing gives focus back to where it was.
 */
export function createRecipeBook(root: HTMLElement, options: RecipeBookOptions): RecipeBookScreen {
  let station: string | null = null;
  let shown = '';
  let page: RecipePage | null = null;
  let focusBefore: HTMLElement | null = null;
  root.tabIndex = -1;

  function row(entry: RecipeRow, at: string, language: Language): HTMLElement {
    const lines = entry.ingredients.map(({ item, have, need }) =>
      el('li', { className: have < need ? 'recipe-need short' : 'recipe-need', text: format('book.have', language, { item: itemName(item, language), count: have, of: need }) }),
    );
    const cook = button('primary recipe-cook', text('book.cook', language), () => options.cook(entry.recipe, at));
    cook.disabled = entry.blocked !== null;
    const parts: HTMLElement[] = [
      el('div', { className: 'recipe-top' }, [itemIcon(entry.makes), el('div', { className: 'recipe-name' }, [el('span', { text: itemName(entry.makes, language) }), stars(entry.stars, language)])]),
      el('ul', { className: 'recipe-needs' }, lines),
      cook,
    ];
    if (entry.blocked) parts.push(el('p', { className: 'recipe-why', text: format(BLOCK_TEXT[entry.blocked], language, { item: itemName(entry.makes, language) }) }));
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
      button('primary book-close', text('team.close', language), () => {
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
    const hadFocus = station !== null && root.contains(document.activeElement);
    station = null;
    page = null;
    shown = '';
    render();
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
