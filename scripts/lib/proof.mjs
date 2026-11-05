// Where verify keeps its evidence. Each run writes only its own folder, .proof/<sha>/<run>/, so a
// lower level (the pre-push hook's level 0) never replaces a higher level's proof of the same commit.
// .proof/<sha>/summary.json is a copy of the summary that stands for the commit.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The folder name of one run: L0 to L4, and L4-container with the container check. */
export const runName = (level, container) => `L${level}${container ? '-container' : ''}`;

const rank = (summary) => summary.level * 2 + (summary.run?.endsWith('-container') ? 1 : 0);

/** The highest run that passed (a container run above plain level 4), or `latest` when none did. */
export function standingSummary(summaries, latest) {
  const passed = summaries.filter((summary) => summary?.ok === true).toSorted((a, b) => rank(b) - rank(a));
  return passed[0] ?? latest;
}

/** Every run summary already written for this commit. */
export function runSummaries(proof) {
  if (!existsSync(proof)) return [];
  return readdirSync(proof, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^L\d(-container)?$/.test(entry.name))
    .flatMap((entry) => {
      try {
        return [JSON.parse(readFileSync(join(proof, entry.name, 'summary.json'), 'utf8'))];
      } catch {
        return [];
      }
    });
}
