import { DUEL_ANSWER_MS, DUEL_PAUSE_MS } from '@nebotok/core';

/**
 * The duel asks waiting for an answer in a world room, and the pause after a decline
 * (docs/protocol.md, "Arena fights"). Asks live only in memory: an ask is over when either player
 * leaves, and a restart forgets them all.
 */

/** `from` asked `to`, both by session id, at `at`; the players' profile ids key the pause after a decline. */
export type DuelAsk = {
  readonly from: string;
  readonly to: string;
  readonly fromPlayer: number;
  readonly toPlayer: number;
  readonly even: boolean;
  readonly at: number;
};

/** How an ask ended: a yes, a no, no answer in time, taken back, or one of the two could no longer duel. */
export type AskEnd = 'accepted' | 'declined' | 'timedOut' | 'cancelled' | 'gone';

const pairOf = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export type DuelDesk = ReturnType<typeof createDuelDesk>;

export function createDuelDesk() {
  const asks = new Set<DuelAsk>();
  /** When each pair of players declined last, while its pause lasts. */
  const declinedAt = new Map<string, number>();

  return {
    open(ask: DuelAsk) {
      asks.add(ask);
    },
    /** The ask the player with this session made or waits to answer, if any. */
    of: (sessionId: string): DuelAsk | undefined => [...asks].find((ask) => ask.from === sessionId || ask.to === sessionId),
    /** The ask waiting for this session's answer, if any. */
    waitingFor: (sessionId: string): DuelAsk | undefined => [...asks].find((ask) => ask.to === sessionId),
    /** The ask this session made, if any. */
    madeBy: (sessionId: string): DuelAsk | undefined => [...asks].find((ask) => ask.from === sessionId),
    /** Ends an ask; a no or no answer starts the pair's pause. */
    close(ask: DuelAsk, end: AskEnd, at: number) {
      asks.delete(ask);
      if (end === 'declined' || end === 'timedOut') declinedAt.set(pairOf(ask.fromPlayer, ask.toPlayer), at);
    },
    /** Whether two players still wait after a decline between them. */
    paused(a: number, b: number, at: number): boolean {
      for (const [pair, when] of declinedAt) if (at - when >= DUEL_PAUSE_MS) declinedAt.delete(pair);
      return declinedAt.has(pairOf(a, b));
    },
    /** The asks left without an answer for `DUEL_ANSWER_MS` at `at`. */
    expired: (at: number): DuelAsk[] => [...asks].filter((ask) => at - ask.at >= DUEL_ANSWER_MS),
    all: (): DuelAsk[] => [...asks],
  };
}
