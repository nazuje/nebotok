import type { z } from 'zod';

/** Adds an issue for every entry whose `id` an earlier entry of `key` already has. */
export function noRepeatedIds(entries: readonly { readonly id: string }[], key: string, ctx: z.RefinementCtx): void {
  const ids = entries.map((entry) => entry.id);
  ids.forEach((id, at) => {
    if (ids.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `"${id}" appears twice`, path: [key, at, 'id'] });
  });
}
