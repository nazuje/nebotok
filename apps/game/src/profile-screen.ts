import { MAX_PROFILES, PIN_LOCK_MS, ProfileName, type Language, type LoginResponse, type ProfileSummary, type StringId } from '@nebotok/core';
import { createProfile, listProfiles, login, type ApiProblem } from './api.ts';
import { AVATARS, avatarPortrait } from './avatars.ts';
import { button, el, icon } from './dom.ts';
import { lockedNotice, lockedTag } from './lock-wait.ts';
import { text } from './strings.ts';

export const PIN_LENGTH = 4;
/** A backspace key: a tag shape pointing left with a cross cut out of it. */
const DELETE_ICON = 'M9 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-7-7zM12 10.4 13.4 9 15 10.6 16.6 9 18 10.4 16.4 12 18 13.6 16.6 15 15 13.4 13.4 15 12 13.6 13.6 12z';
/** A padlock in outline with its shackle open, for profiles that have no PIN yet. */
const OPEN_LOCK_ICON = 'M7 10V7a5 5 0 0 1 10 0h-2a3 3 0 0 0-6 0v3zM6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM6 12h12v8H6z';
const LOCK_TICK_MS = 1_000;

export type ProfileView = 'loading' | 'profiles' | 'newProfile' | 'pin';

export type ProfileScreenState = {
  readonly view: ProfileView;
  readonly busy: boolean;
  readonly notice: StringId | null;
  readonly profiles: readonly { readonly id: number; readonly name: string; readonly avatar: string; readonly hasPin: boolean; readonly locked: boolean }[];
  readonly pinFor: 'enter' | 'choose' | null;
  readonly pinDigits: number;
  readonly draft: { readonly avatar: string; readonly hasPin: boolean };
};

export type ProfileScreen = {
  /** Shows the list, fetched fresh, with an optional notice such as why the session ended. */
  show(notice: StringId | null): void;
  hide(): void;
  setLanguage(language: Language): void;
  state(): ProfileScreenState;
};

export function noticeFor(error: ApiProblem): StringId {
  return error === 'unreachable' ? 'connection.unreachable' : `profile.error.${error}`;
}

/** Errors a PIN pad can show and stay on, so the player can simply type again. */
const RETRY_ON_PAD: ReadonlySet<ApiProblem> = new Set(['pinWrong', 'pinInvalid', 'busy', 'unreachable']);

type PinFor = { readonly kind: 'enter'; readonly profile: ProfileSummary } | { readonly kind: 'choose' };
type Draft = { avatar: string; name: string; pin: string | undefined };

const freshDraft = (): Draft => ({ avatar: AVATARS[0]?.id ?? 'blue', name: '', pin: undefined });

const secondsUntil = (at: number) => Math.max(0, (at - performance.now()) / 1_000);

function setText(node: HTMLElement, value: string) {
  // Only a real change, so the alert line is not read out again every second.
  if (node.textContent !== value) node.textContent = value;
}

/**
 * "Who's playing?": pick a profile (with its PIN on a number pad), or make a new one. All HTML over
 * the canvas, rebuilt per view; typing and PIN digits update in place so focus and taps are kept.
 */
export function createProfileScreen(root: HTMLElement, options: { language: () => Language; signedIn: (login: LoginResponse) => void }): ProfileScreen {
  let visible = false;
  let view: ProfileView = 'loading';
  let busy = false;
  let notice: StringId | null = null;
  let loadFailed = false;
  let profiles: readonly ProfileSummary[] = [];
  let pinFor: PinFor | null = null;
  let pin = '';
  let draft = freshDraft();
  let dots: readonly HTMLElement[] = [];
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  // Locks count down on the page clock from when the list (or a refused login) said how long is left.
  let listedAt = 0;
  let lockNoticeUntil = 0;
  let lockTicker: ReturnType<typeof setInterval> | undefined;
  let lockTags: { readonly tag: HTMLElement; readonly profile: ProfileSummary }[] = [];
  let noticeShown: HTMLElement | null = null;

  const t = (id: StringId) => text(id, options.language());
  const unlocksAt = (profile: ProfileSummary) => listedAt + profile.lockedForSeconds * 1_000;
  const noticeText = (id: StringId) => (id === 'profile.error.locked' ? lockedNotice(secondsUntil(lockNoticeUntil), options.language()) : t(id));

  const go = (next: ProfileView, nextNotice: StringId | null = null) => {
    view = next;
    notice = nextNotice;
    render();
  };

  const noticeLine = () => {
    const line = el('p', { className: 'notice', text: notice ? noticeText(notice) : '', attrs: { role: 'alert' } });
    line.hidden = notice === null;
    noticeShown = line;
    return line;
  };

  function profileCard(profile: ProfileSummary): HTMLButtonElement {
    const card = button('profile-card', '', () => void choose(profile));
    card.dataset.profileId = String(profile.id);
    card.append(avatarPortrait(profile.avatar), el('span', { className: 'profile-name', text: profile.name }));
    const tags: HTMLElement[] = [];
    if (profile.hasPin) tags.push(el('span', { className: 'tag', text: t('profile.hasPin') }));
    else tags.push(el('span', { className: 'tag no-pin' }, [icon(OPEN_LOCK_ICON)]));
    if (profile.lockedForSeconds > 0) {
      const tag = el('span', { className: 'tag locked', text: lockedTag(secondsUntil(unlocksAt(profile)), options.language()) });
      lockTags.push({ tag, profile });
      tags.push(tag);
    }
    if (tags.length > 0) card.append(el('span', { className: 'tags' }, tags));
    return card;
  }

  function buildProfiles(): Node[] {
    const parts: Node[] = [el('h2', { className: 'screen-title', text: t('profile.title') }), noticeLine()];
    if (view === 'loading') return [...parts, el('p', { className: 'hint centred', text: t('connection.connecting') })];
    if (loadFailed) return [...parts, button('primary retry', t('profile.retry'), () => void refresh(null))];
    if (profiles.length === 0) parts.push(el('p', { className: 'hint centred', text: t('profile.empty') }));
    else parts.push(el('ul', { className: 'profile-list' }, profiles.map((profile) => el('li', {}, [profileCard(profile)]))));
    if (profiles.some((profile) => !profile.hasPin)) parts.push(el('p', { className: 'hint pin-nudge' }, [icon(OPEN_LOCK_ICON), el('span', { text: t('profile.pinNudge') })]));
    if (profiles.length >= MAX_PROFILES) parts.push(el('p', { className: 'hint centred list-full', text: t('profile.error.full') }));
    else parts.push(button('primary new-profile', t('profile.new'), () => go('newProfile')));
    return parts;
  }

  function buildNewProfile(): Node[] {
    const language = options.language();
    const looks = AVATARS.map((avatar) => {
      const choice = button('avatar-choice', '', () => {
        draft.avatar = avatar.id;
        for (const other of root.querySelectorAll<HTMLElement>('.avatar-choice')) other.setAttribute('aria-pressed', String(other.dataset.avatar === avatar.id));
      });
      choice.dataset.avatar = avatar.id;
      choice.setAttribute('aria-pressed', String(draft.avatar === avatar.id));
      choice.setAttribute('aria-label', avatar.name[language]);
      choice.append(avatarPortrait(avatar.id));
      return choice;
    });
    const input = el('input', {
      className: 'name-input',
      attrs: { type: 'text', id: 'profile-name', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', maxlength: '16', 'aria-describedby': 'profile-name-hint' },
    });
    input.value = draft.name;
    input.addEventListener('input', () => {
      draft.name = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void create();
      }
    });
    const pinField =
      draft.pin === undefined
        ? el('div', { className: 'field' }, [button('secondary pin-choose', t('profile.pin'), () => openPad({ kind: 'choose' })), el('p', { className: 'hint', text: t('profile.pinHint') })])
        : el('div', { className: 'field pin-row' }, [
            el('p', { className: 'pin-set', text: t('profile.pinSet') }),
            button('secondary pin-remove', t('profile.pinRemove'), () => {
              draft.pin = undefined;
              render();
            }),
          ]);
    const form = el('div', { className: 'card' }, [
      el('div', { className: 'field' }, [el('p', { className: 'label', text: t('profile.avatar') }), el('div', { className: 'avatar-choices', attrs: { role: 'group', 'aria-label': t('profile.avatar') } }, looks)]),
      el('div', { className: 'field' }, [el('label', { className: 'label', text: t('profile.name'), attrs: { for: 'profile-name' } }), input, el('p', { className: 'hint', text: t('profile.nameHint'), attrs: { id: 'profile-name-hint' } })]),
      pinField,
    ]);
    const actions = el('div', { className: 'actions' }, [
      button('secondary back', t('profile.back'), () => {
        draft = freshDraft();
        void refresh(null);
      }),
      button('primary create', t('profile.create'), () => void create()),
    ]);
    return [el('h2', { className: 'screen-title', text: t('profile.new') }), form, noticeLine(), actions];
  }

  function padKey(digit: string): HTMLButtonElement {
    const made = button('pin-key', digit, () => void press(digit));
    made.dataset.digit = digit;
    return made;
  }

  function buildPad(): Node[] {
    const who = pinFor?.kind === 'enter' ? pinFor.profile : null;
    const parts: Node[] = [];
    if (who) parts.push(el('div', { className: 'pin-who' }, [avatarPortrait(who.avatar), el('span', { className: 'profile-name', text: who.name })]));
    parts.push(el('h2', { className: 'screen-title', text: t(who ? 'profile.pinPrompt' : 'profile.pinChoose') }));
    dots = Array.from({ length: PIN_LENGTH }, () => el('span', { className: 'pin-dot' }));
    parts.push(el('div', { className: 'pin-dots', attrs: { 'aria-hidden': 'true' } }, dots), noticeLine());
    const erase = button('pin-key pin-delete', '', removeDigit);
    erase.setAttribute('aria-label', t('profile.pinDelete'));
    erase.append(icon(DELETE_ICON));
    parts.push(el('div', { className: 'pin-pad' }, [...[...'123456789'].map(padKey), button('pin-key pin-back', t('profile.back'), leavePad), padKey('0'), erase]));
    showDots();
    return parts;
  }

  function render() {
    root.hidden = !visible;
    root.dataset.view = view;
    root.setAttribute('aria-busy', String(busy));
    lockTags = [];
    noticeShown = null;
    if (visible) {
      const parts = view === 'newProfile' ? buildNewProfile() : view === 'pin' ? buildPad() : buildProfiles();
      root.replaceChildren(el('div', { className: 'screen-body' }, parts));
    }
    keepLocksTicking();
  }

  function tickLocks() {
    const language = options.language();
    for (const { tag, profile } of lockTags) setText(tag, lockedTag(secondsUntil(unlocksAt(profile)), language));
    if (noticeShown && notice === 'profile.error.locked') setText(noticeShown, noticeText(notice));
  }

  function keepLocksTicking() {
    const needed = visible && (lockTags.length > 0 || (noticeShown !== null && notice === 'profile.error.locked'));
    if (needed && lockTicker === undefined) lockTicker = setInterval(tickLocks, LOCK_TICK_MS);
    if (!needed && lockTicker !== undefined) {
      clearInterval(lockTicker);
      lockTicker = undefined;
    }
  }

  const setBusy = (next: boolean) => {
    busy = next;
    root.setAttribute('aria-busy', String(busy));
  };

  function showDots() {
    dots.forEach((dot, at) => dot.classList.toggle('filled', at < pin.length));
  }

  function scheduleUnlock() {
    clearTimeout(unlockTimer);
    const waits = profiles.map((profile) => profile.lockedForSeconds).filter((seconds) => seconds > 0);
    if (waits.length === 0) return;
    unlockTimer = setTimeout(() => {
      const lockOver = notice === 'profile.error.locked' && secondsUntil(lockNoticeUntil) === 0;
      if (visible && view === 'profiles' && !busy) void refresh(lockOver ? null : notice);
    }, (Math.min(...waits) + 1) * 1_000);
  }

  async function refresh(nextNotice: StringId | null) {
    pinFor = null;
    pin = '';
    go('loading', nextNotice);
    setBusy(true);
    const result = await listProfiles();
    setBusy(false);
    loadFailed = !result.ok;
    if (result.ok) {
      profiles = result.value;
      listedAt = performance.now();
    }
    go('profiles', result.ok ? nextNotice : noticeFor(result.error));
    scheduleUnlock();
  }

  function openPad(next: PinFor) {
    pinFor = next;
    pin = '';
    go('pin');
  }

  function leavePad() {
    if (busy) return;
    const was = pinFor;
    pinFor = null;
    pin = '';
    if (was?.kind === 'choose') go('newProfile');
    else void refresh(null);
  }

  function removeDigit() {
    if (busy) return;
    pin = pin.slice(0, -1);
    showDots();
  }

  async function press(digit: string) {
    if (busy || pin.length >= PIN_LENGTH || !pinFor) return;
    pin += digit;
    showDots();
    if (pin.length < PIN_LENGTH) return;
    const entered = pin;
    if (pinFor.kind === 'choose') {
      draft.pin = entered;
      pinFor = null;
      pin = '';
      go('newProfile');
      return;
    }
    await signIn(pinFor.profile, entered);
  }

  async function signIn(profile: ProfileSummary, withPin: string | undefined) {
    setBusy(true);
    const result = await login(profile.id, withPin);
    setBusy(false);
    pin = '';
    if (result.ok) {
      options.signedIn(result.value);
      return;
    }
    if (result.error === 'locked') lockNoticeUntil = performance.now() + (result.retryAfterSeconds ?? PIN_LOCK_MS / 1_000) * 1_000;
    if (view === 'pin' && RETRY_ON_PAD.has(result.error)) go('pin', noticeFor(result.error));
    else await refresh(noticeFor(result.error));
  }

  async function choose(profile: ProfileSummary) {
    if (busy) return;
    if (profile.lockedForSeconds > 0) {
      lockNoticeUntil = unlocksAt(profile);
      go('profiles', 'profile.error.locked');
    }
    else if (profile.hasPin) openPad({ kind: 'enter', profile });
    else await signIn(profile, undefined);
  }

  async function create() {
    if (busy) return;
    const name = ProfileName.safeParse(draft.name);
    if (!name.success) {
      go('newProfile', 'profile.error.nameInvalid');
      root.querySelector<HTMLInputElement>('.name-input')?.focus();
      return;
    }
    setBusy(true);
    const made = await createProfile(name.data, draft.avatar, draft.pin);
    if (!made.ok) {
      setBusy(false);
      go('newProfile', noticeFor(made.error));
      return;
    }
    const signed = await login(made.value.id, draft.pin);
    setBusy(false);
    if (!signed.ok) {
      draft = freshDraft();
      await refresh(noticeFor(signed.error));
      return;
    }
    draft = freshDraft();
    options.signedIn(signed.value);
  }

  // A laptop can type the PIN too.
  document.addEventListener('keydown', (event) => {
    if (!visible || view !== 'pin' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (/^[0-9]$/.test(event.key)) void press(event.key);
    else if (event.key === 'Backspace') removeDigit();
    else if (event.key === 'Escape') leavePad();
    else return;
    event.preventDefault();
  });

  return {
    show: (nextNotice) => {
      visible = true;
      void refresh(nextNotice);
    },
    hide: () => {
      visible = false;
      clearTimeout(unlockTimer);
      render();
    },
    setLanguage: () => render(),
    state: () => ({
      view,
      busy,
      notice,
      profiles: profiles.map(({ id, name, avatar, hasPin, lockedForSeconds }) => ({ id, name, avatar, hasPin, locked: lockedForSeconds > 0 })),
      pinFor: pinFor?.kind ?? null,
      pinDigits: pin.length,
      draft: { avatar: draft.avatar, hasPin: draft.pin !== undefined },
    }),
  };
}
