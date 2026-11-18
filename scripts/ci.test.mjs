import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lib/server-process.mjs';

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const workflow = read('.github/workflows/ci.yml');
/** The job's `container:` image, as `name:tag@sha256:digest`. */
const container = /\n {4}container:\n {6}image: (\S+)\n/.exec(workflow)?.[1] ?? null;

describe('the CI workflow', () => {
  it('pins every image by digest', () => {
    const images = [...workflow.matchAll(/^\s*(?:image:|driver-opts: image=)\s*(\S+)\s*$/gm)].map((match) => match[1]);
    expect(images.length).toBeGreaterThan(2);
    for (const image of images) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
  });

  // Dependabot updates Playwright in package-lock.json but not the workflow's container, and the
  // image only holds the browsers of its own Playwright version.
  it("verifies in Playwright's image for the Playwright in package-lock.json", () => {
    const playwright = JSON.parse(read('package-lock.json')).packages['node_modules/playwright'].version;
    expect(container).toMatch(new RegExp(`^mcr\\.microsoft\\.com/playwright:v${playwright.replaceAll('.', '\\.')}-noble@sha256:[0-9a-f]{64}$`));
  });

  it('installs no system packages', () => {
    expect(workflow).not.toMatch(/--with-deps|install-deps|apt-get|apt install/);
  });
});
