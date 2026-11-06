import { emptyProgress, progressMessage, type MoveOffer } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/battle-link.ts';
import { createLearnModel } from '../src/learn-prompt.ts';

const OFFER: MoveOffer = { offer: 7, index: 1, species: 'glowbun', move: 'sun-wallop', moves: ['sun-ray', 'storm-tap', 'sun-call', 'heat-shimmer'] };
const offered: ServerMessage = { type: 'move.offer', payload: OFFER };
const progress: ServerMessage = { type: 'progress', payload: progressMessage(emptyProgress()) };
const refused = (reason: 'invalid' | 'notNow'): ServerMessage => ({ type: 'refused', payload: { request: 'move.choose', reason } });

describe('the move-learning prompt', () => {
  it('shows an offer, and stays up through the progress the server sends with it', () => {
    const learn = createLearnModel();
    expect(learn.current()).toBeNull();
    learn.receive(offered);
    learn.receive(progress);
    expect(learn.current()).toEqual({ offer: OFFER, sent: false });
  });

  it('answers once, forgetting a slot or skipping, and goes once the progress after it comes', () => {
    const learn = createLearnModel();
    learn.receive(offered);
    expect(learn.answer(2)).toEqual({ type: 'move.choose', payload: { offer: 7, forget: 2 } });
    expect(learn.current()?.sent).toBe(true);
    expect(learn.answer(null)).toBeNull();
    learn.receive(progress);
    expect(learn.current()).toBeNull();

    learn.receive(offered);
    expect(learn.answer(null)).toEqual({ type: 'move.choose', payload: { offer: 7, forget: null } });
  });

  it('never sends a slot the creature has no move in, or an answer with no offer', () => {
    const learn = createLearnModel();
    expect(learn.answer(0)).toBeNull();
    learn.receive(offered);
    expect(learn.answer(4)).toBeNull();
    expect(learn.answer(-1)).toBeNull();
    expect(learn.current()?.sent).toBe(false);
  });

  it('shows the next offer in place of an answered one', () => {
    const learn = createLearnModel();
    learn.receive(offered);
    learn.answer(0);
    const next: MoveOffer = { ...OFFER, offer: 8, move: 'storm-wallop' };
    learn.receive({ type: 'move.offer', payload: next });
    learn.receive(progress);
    expect(learn.current()).toEqual({ offer: next, sent: false });
  });

  it('lets a refused answer be tried again, and puts the prompt away when the server has no offer', () => {
    const learn = createLearnModel();
    learn.receive(offered);
    learn.answer(0);
    learn.receive(refused('invalid'));
    expect(learn.current()).toEqual({ offer: OFFER, sent: false });
    learn.answer(0);
    learn.receive(refused('notNow'));
    expect(learn.current()).toBeNull();
  });

  it('forgets the offer on reset', () => {
    const learn = createLearnModel();
    learn.receive(offered);
    learn.reset();
    expect(learn.current()).toBeNull();
  });
});
