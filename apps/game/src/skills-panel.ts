import { spriteFor, type Language, type SkillsMessage, type StoryContent } from '@nebotok/core';
import { itemName } from './battle-content.ts';
import { el } from './dom.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';
import { spriteCanvas } from './skill-games/mini-game.ts';
import { format, text } from './strings.ts';

/** One skill as the Skills tab shows it: level, XP toward the next and what the next level brings. */
export type SkillRow = {
  readonly skill: string;
  readonly level: number;
  readonly xp: number;
  /** The XP the next level needs in all, or 0 at the top level. */
  readonly of: number;
  readonly next: { readonly level: number; readonly items: readonly string[] } | null;
};

/**
 * What reaching a higher `skill` level first brings: the lowest level above `level` that unlocks a
 * spot or recipe, with the items they give in content order, each once. Null when nothing is left.
 */
export function nextUnlock(skill: string, level: number, content: StoryContent): SkillRow['next'] {
  const skills = content.skills;
  if (!skills) return null;
  const uses = skills.skills.get(skill)?.uses;
  const found =
    uses === 'recipes'
      ? [...skills.recipes.values()].map((recipe) => ({ level: recipe.level, item: recipe.makes }))
      : [...skills.spots.values()].filter((spot) => spot.skill === skill).map((spot) => ({ level: spot.level, item: spot.item }));
  const later = found.filter((each) => each.level > level);
  if (later.length === 0) return null;
  const at = Math.min(...later.map((each) => each.level));
  return { level: at, items: [...new Set(later.filter((each) => each.level === at).map((each) => each.item))] };
}

/** The spots and recipes a level of `skill` unlocks, by name: what a level-up toast lists. */
export function unlockedAt(skill: string, level: number, content: StoryContent, language: Language): string[] {
  const skills = content.skills;
  if (!skills) return [];
  const names =
    skills.skills.get(skill)?.uses === 'recipes'
      ? [...skills.recipes.values()].filter((recipe) => recipe.level === level).map((recipe) => itemName(recipe.makes, language))
      : [...skills.spots.values()].filter((spot) => spot.skill === skill && spot.level === level).map((spot) => spot.name[language]);
  return [...new Set(names)];
}

/** The Skills tab's rows, in the order the server lists the skills. */
export function skillRows(message: SkillsMessage, content: StoryContent): SkillRow[] {
  return message.skills.map(({ skill, level, xp, toNext }) => ({ skill, level, xp, of: toNext === 0 ? 0 : xp + toNext, next: nextUnlock(skill, level, content) }));
}

const skillName = (skill: string, content: StoryContent, language: Language) => content.skills?.skills.get(skill)?.name[language] ?? skill;

/** What the next level brings, as each item's icon with a lock on it and the level as a small badge, then the words ("Level 5: Sky Mint"). */
function nextRow(next: NonNullable<SkillRow['next']>, language: Language): HTMLElement {
  const locked = next.items.map((item) => el('span', { className: 'locked-item' }, [spriteIcon(spriteFor.item(item), 32), pictureIcon('lock', 16, { className: 'locked-item-lock' })]));
  const pictures = el('span', { className: 'skill-next-pictures', attrs: { 'aria-hidden': 'true' } }, [...locked, el('span', { className: 'level-badge', text: String(next.level) })]);
  const words = el('span', { className: 'skill-row-next', text: format('skills.next', language, { level: next.level, names: next.items.map((item) => itemName(item, language)).join(', ') }) });
  return el('div', { className: 'skill-next' }, [pictures, words]);
}

/** The Skills tab of the journal: each skill's icon, its level as a big badge, an XP bar ("120 / 245 XP") and its next unlock as pictures. */
export function skillsPanel(message: SkillsMessage | null, content: StoryContent, language: Language): HTMLElement[] {
  const rows = message ? skillRows(message, content) : [];
  if (rows.length === 0) return [el('p', { className: 'hint centred', text: text('skills.empty', language) })];
  const cards = rows.map((row) => {
    const top = row.of === 0;
    const fill = el('span', { className: 'skill-xp-fill' });
    fill.style.width = top ? '100%' : `${Math.min(100, Math.round((row.xp * 100) / row.of))}%`;
    const bar = el('span', { className: 'skill-xp-bar', attrs: { 'aria-hidden': 'true' } }, [fill]);
    const parts: HTMLElement[] = [
      el('div', { className: 'skill-row-head' }, [
        spriteCanvas(spriteFor.skill(row.skill), null, 'skill-icon'),
        el('span', { className: 'skill-row-name', text: skillName(row.skill, content, language) }),
        el('span', { className: 'skill-row-level', attrs: { role: 'img', 'aria-label': format('skills.level', language, { level: row.level }) } }, [el('span', { text: String(row.level), attrs: { 'aria-hidden': 'true' } })]),
      ]),
      bar,
      el('p', { className: 'skill-row-xp', text: top ? text('skills.top', language) : format('skills.xp', language, { xp: row.xp, of: row.of }) }),
    ];
    if (row.next) parts.push(nextRow(row.next, language));
    return el('li', { className: 'skill-row', attrs: { 'data-skill': row.skill } }, parts);
  });
  return [el('ul', { className: 'skill-list' }, cards)];
}
