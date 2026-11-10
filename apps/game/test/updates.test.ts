import { describe, expect, it } from 'vitest';
import { isNewerBuild, offerToShow } from '../src/updates.ts';

const page = (script: string) => `<!doctype html><html><head><script type="module" crossorigin src="${script}"></script></head><body></body></html>`;

describe('isNewerBuild', () => {
  it('sees a new build when / loads another script', () => {
    expect(isNewerBuild(page('/assets/index-B.js'), '/assets/index-A.js')).toBe(true);
  });

  it('sees no new build when / loads the same script', () => {
    expect(isNewerBuild(page('/assets/index-A.js'), '/assets/index-A.js')).toBe(false);
  });

  it('does not take a name that only starts the same for the same script', () => {
    expect(isNewerBuild(page('/assets/index-A.js'), '/assets/index-A')).toBe(true);
  });

  it('says nothing for an answer that is not the page, or a page with no script of its own', () => {
    expect(isNewerBuild('{"ok":true}', '/assets/index-A.js')).toBe(false);
    expect(isNewerBuild(page('/assets/index-B.js'), null)).toBe(false);
  });
});

describe('offerToShow', () => {
  it('offers Reload on a refused page, even in a battle or a talk', () => {
    expect(offerToShow(true, false, false)).toBe('reload');
    expect(offerToShow(true, true, true)).toBe('reload');
  });

  it('offers a new build only while the player is free', () => {
    expect(offerToShow(false, true, false)).toBe('update');
    expect(offerToShow(false, true, true)).toBeNull();
  });

  it('offers nothing when the page is current', () => {
    expect(offerToShow(false, false, false)).toBeNull();
  });
});
