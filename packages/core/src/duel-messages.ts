import { z } from 'zod';

/**
 * The world room's duel messages (docs/protocol.md, "Arena fights"): one player asks another near
 * them, who answers yes or no. The rules are in arena/duels.ts.
 */

/** A player's key in the world state's `players` (their Colyseus session id). */
const PlayerKey = z.string().min(1).max(32);

/** `duel.ask`: asks the player with key `to` for a duel, an even match or at real levels. */
export const DuelAskMessage = z.strictObject({ to: PlayerKey, even: z.boolean() });
export type DuelAskMessage = z.infer<typeof DuelAskMessage>;

/** `duel.answer`: the answer to the ask waiting for you. */
export const DuelAnswerMessage = z.strictObject({ yes: z.boolean() });
export type DuelAnswerMessage = z.infer<typeof DuelAnswerMessage>;

/** `duel.cancel`: takes back your ask. */
export const DuelCancelMessage = z.strictObject({});
export type DuelCancelMessage = z.infer<typeof DuelCancelMessage>;

/** `duel.watch`: watches the duel the player with key `who` is in. */
export const DuelWatchMessage = z.strictObject({ who: PlayerKey });
export type DuelWatchMessage = z.infer<typeof DuelWatchMessage>;

/** One of the asker's creatures as the answer card shows it, at its real level. */
export type DuelCreature = { readonly species: string; readonly level: number };

/** `duel.asked`: `from` (their key in `players`) asks you, with these creatures, even match or not. */
export type DuelAskedMessage = { readonly from: string; readonly creatures: readonly DuelCreature[]; readonly even: boolean };

/**
 * `duel.answered`: the ask between you is over, sent to both players. `yes` when it was accepted
 * and the duel starts (`arena.join` follows); false when it was declined, declined by itself, taken
 * back, or one of you could no longer duel.
 */
export type DuelAnsweredMessage = { readonly yes: boolean };
