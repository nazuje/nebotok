import { DEFAULT_COURIER, REFUSAL_REASONS, courierFrame, spriteFor, type RefusalReason, type StringId } from '@nebotok/core';
import { el } from './dom.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';

/**
 * The pictures beside the game's short messages, so a player who cannot read yet still sees why
 * something was turned down, or what went well: every refusal reason has one, and so do the other
 * toasts.
 */

/** The tile the map draws a shrine with. */
export const SHRINE_SPRITE = 'tiles/shrine';

/** The picture each refusal shows beside its words. */
export const REFUSAL_PICTURES: Readonly<Record<RefusalReason, string>> = {
  notInBattle: spriteFor.picture('cross'),
  inBattle: spriteFor.picture('trophy'),
  notNow: spriteFor.picture('clock'),
  noItem: spriteFor.picture('cross'),
  notAtShrine: SHRINE_SPRITE,
  full: spriteFor.picture('bag-full'),
  invalid: spriteFor.picture('again'),
  tooFar: spriteFor.picture('footprints'),
  notTalking: spriteFor.picture('cross'),
  resting: spriteFor.picture('clock'),
  needsLevel: spriteFor.picture('lock'),
  bagFull: spriteFor.picture('bag-full'),
};

/** The other short messages and their pictures. */
const NEWS_PICTURES: Readonly<Partial<Record<StringId, string>>> = {
  'battle.interrupted': spriteFor.picture('cloud-off'),
  'shrine.rested': SHRINE_SPRITE,
  'profile.error.hasPin': spriteFor.picture('lock'),
  'duel.no': spriteFor.picture('cross'),
};

const isRefusal = (reason: string): reason is RefusalReason => (REFUSAL_REASONS as readonly string[]).includes(reason);

/** The sprite a short message shows beside its words, or null for one without a picture. */
export function toastPicture(id: StringId): string | null {
  const reason = id.startsWith('refused.') ? id.slice('refused.'.length) : '';
  if (isRefusal(reason)) return REFUSAL_PICTURES[reason];
  return NEWS_PICTURES[id] ?? null;
}

/** The notices of a session that ended, which show the courier walking back to the profile list. */
const WALKED_BACK: ReadonlySet<StringId> = new Set<StringId>(['connection.signedOut', 'profile.takenOver']);

/** The picture of a profile screen notice, or null: a courier walking back, after an arrow pointing back, when a session ended. */
export function noticePicture(notice: StringId): HTMLElement | null {
  if (!WALKED_BACK.has(notice)) return null;
  return el('span', { className: 'notice-picture', attrs: { 'aria-hidden': 'true' } }, [
    pictureIcon('arrow', 32, { mirrored: true }),
    spriteIcon(DEFAULT_COURIER, 48, { frame: courierFrame('right', 'step-a'), mirrored: true, className: 'notice-courier' }),
  ]);
}

const itemPicture = (item: string) => spriteIcon(spriteFor.item(item), 32);

const levelBadge = (level: number) => el('span', { className: 'level-badge', text: String(level) });

/** What a skill start turned down is about: the skill, the level it needs and the item it gives. */
export type SkillNeeds = { readonly skill: string; readonly level: number; readonly item: string };

/**
 * A refused skill start as pictures: the item with a lock and the level it needs, the item beside
 * a clock while its spot rests or a full bag when there is no room, else the reason's own picture.
 */
export function skillRefusalPicture(reason: RefusalReason, needs: SkillNeeds | null): HTMLElement {
  const own = spriteIcon(REFUSAL_PICTURES[reason], 32);
  const parts: HTMLElement[] = [own];
  if (needs && reason === 'needsLevel') parts.splice(0, 1, el('span', { className: 'locked-item' }, [itemPicture(needs.item), pictureIcon('lock', 16, { className: 'locked-item-lock' })]), levelBadge(needs.level));
  else if (needs && (reason === 'resting' || reason === 'bagFull')) parts.push(itemPicture(needs.item));
  return el('span', { className: 'message-picture', attrs: { 'data-reason': reason, 'aria-hidden': 'true' } }, parts);
}

/** A skill level up as a fanfare: the skill's icon in a burst of light, its new level, and the items it unlocks. */
export function levelUpPicture(skill: string, level: number, unlocked: readonly string[]): HTMLElement {
  const icon = el('span', { className: 'level-up-icon' }, [pictureIcon('star-burst', 64, { className: 'level-up-burst' }), spriteIcon(spriteFor.skill(skill), 48, { className: 'level-up-skill' })]);
  const parts: HTMLElement[] = [icon, levelBadge(level)];
  if (unlocked.length > 0) parts.push(pictureIcon('arrow', 32), ...unlocked.map(itemPicture));
  return el('span', { className: 'message-picture level-up', attrs: { 'data-skill': skill, 'aria-hidden': 'true' } }, parts);
}
