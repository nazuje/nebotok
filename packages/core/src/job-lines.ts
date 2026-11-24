/**
 * What a job's card reads aloud: the whole sentence its template's `say` writes for the job's
 * count (and, for a delivery, its character), in the plural form the count takes (`jobLine`), and
 * every count a template can ask for (`jobCounts`), so `npm run voice` makes a clip for each.
 */
import type { Language } from './content.ts';
import { jobCount } from './job-reach.ts';
import { pluralForm, type PluralForm } from './plural.ts';
import type { CountedText, JobTemplate, SkillContent } from './skill-content.ts';

/**
 * Every count a job of `template` can ask for: each roll of its range, grown at each level the board
 * draws it at (from its `needs` level until it is outgrown, at most `maxLevel`), in rising order.
 */
export function jobCounts(template: Pick<JobTemplate, 'count' | 'needs'>, content: Pick<SkillContent, 'maxLevel' | 'countGrowth' | 'outgrownAfter'>): number[] {
  const last = content.outgrownAfter === null ? content.maxLevel : Math.min(content.maxLevel, template.needs.level + content.outgrownAfter - 1);
  const counts = new Set<number>();
  for (let level = template.needs.level; level <= last; level += 1) {
    for (let rolled = template.count[0]; rolled <= template.count[1]; rolled += 1) counts.add(jobCount(rolled, level, content));
  }
  return [...counts].toSorted((a, b) => a - b);
}

/** The sentences a job of `template` going to `to` (null for a gather or cook) says, or null when its template writes none. */
function sentencesFor(template: JobTemplate, to: string | null): CountedText | null {
  if (template.kind !== 'deliver') return template.say ?? null;
  return to !== null && template.say && Object.hasOwn(template.say, to) ? (template.say[to] ?? null) : null;
}

/**
 * The sentence a job's card reads aloud in `language`: its template's sentence in the form `count`
 * takes, with `{count}` filled in. Null when the template writes none for the job.
 */
export function jobLine(template: JobTemplate, count: number, to: string | null, language: Language): string | null {
  const sentences = sentencesFor(template, to);
  if (!sentences) return null;
  const forms: Readonly<Partial<Record<PluralForm, string>>> = sentences[language];
  const sentence = forms[pluralForm(count, language)] ?? forms.other;
  return sentence === undefined ? null : sentence.replaceAll('{count}', String(count));
}
