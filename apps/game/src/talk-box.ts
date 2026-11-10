import { frameNames, spriteFor } from '@nebotok/core';
import { button, el, icon } from './dom.ts';
import { paintFrame, sprite } from './sprites.ts';
import { portraitFrame, type TalkLine } from './talk.ts';

const CLOSE_ICON = 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z';

/** What the talk box shows this frame. */
export type TalkBoxView = {
  /** Another key means another line, so the box is laid out again only then. */
  readonly key: string;
  readonly line: TalkLine;
  /** How many letters of the line are typed so far. */
  readonly typed: number;
  /** An answer is on its way to the server. */
  readonly waiting: boolean;
  readonly closeLabel: string;
};

export type TalkBoxOptions = {
  /** A tap anywhere but a button: show the whole line, or go on once it is shown. */
  tap(): void;
  /** One of the choices, by the index `talk.node` gave it. */
  choose(index: number): void;
  close(): void;
};

export type TalkBox = { render(view: TalkBoxView | null): void };

/**
 * The talk box at the bottom of the screen: the speaker's portrait and name, their line typed
 * letter by letter, up to three choices and a close button. The whole screen above it takes taps
 * and ignores them, so walking stays paused and a tap on the map neither goes on nor ends the talk;
 * only a tap on the box goes on.
 */
export function createTalkBox(root: HTMLElement, options: TalkBoxOptions): TalkBox {
  const portrait = el('canvas', { className: 'talk-portrait', attrs: { 'aria-hidden': 'true' } });
  const name = el('p', { className: 'talk-name' });
  const close = button('talk-close', '', options.close);
  close.append(icon(CLOSE_ICON));
  const said = el('span', { className: 'talk-said' });
  // The rest of the line is laid out but not seen, so the box never grows as it types, and a
  // screen reader reads the whole line at once.
  const unsaid = el('span', { className: 'talk-unsaid' });
  const more = el('span', { className: 'talk-more', attrs: { 'aria-hidden': 'true' } });
  const line = el('p', { className: 'talk-line' }, [said, unsaid, more]);
  const choices = el('div', { className: 'talk-choices' });
  // The close button comes last so Tab reaches the choices, or the line, before it; the
  // stylesheet still draws it in the top corner.
  const box = el('div', { className: 'talk-box', attrs: { role: 'dialog' } }, [el('div', { className: 'talk-head' }, [portrait, name]), line, choices, close]);
  root.replaceChildren(box);
  root.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !box.contains(event.target) || event.target.closest('button')) return;
    options.tap();
  });

  let shownKey: string | null = null;
  let shownTyped = -1;

  function build(view: TalkBoxView) {
    const { speaker, name: speakerName, mood } = view.line;
    portrait.hidden = speaker === null;
    if (speaker !== null) {
      const id = spriteFor.portrait(speaker);
      paintFrame(portrait, id, portraitFrame(frameNames(sprite(id)), mood));
    }
    name.hidden = speakerName === null;
    name.textContent = speakerName ?? '';
    box.setAttribute('aria-label', speakerName ?? view.line.say);
    close.setAttribute('aria-label', view.closeLabel);
    choices.replaceChildren(
      ...view.line.choices.map((choice) => {
        const made = button('talk-choice', choice.say, () => options.choose(choice.index));
        made.dataset.choice = String(choice.index);
        return made;
      }),
    );
    shownTyped = -1;
  }

  return {
    render: (view) => {
      root.hidden = view === null;
      if (!view) {
        shownKey = null;
        return;
      }
      if (view.key !== shownKey) {
        shownKey = view.key;
        build(view);
      }
      const { say } = view.line;
      if (view.typed !== shownTyped) {
        shownTyped = view.typed;
        said.textContent = say.slice(0, view.typed);
        unsaid.textContent = say.slice(view.typed);
      }
      const done = view.typed >= say.length;
      choices.hidden = !done || view.line.choices.length === 0;
      more.hidden = !done || view.line.choices.length > 0 || view.waiting;
      // While no choice is up, the line is what Space or Enter goes on with, so it takes focus.
      if (choices.hidden) line.tabIndex = 0;
      else line.removeAttribute('tabindex');
      root.setAttribute('aria-busy', String(view.waiting));
    },
  };
}
