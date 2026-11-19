import type { Language } from '@nebotok/core';
import { el } from '../dom.ts';
import { format } from '../strings.ts';
import type { NetMeters } from './arena-predict.ts';

/** Whether the page shows the netcode meters over the fight: only with `?test=1&net=1`. */
export function netMetersAsked(search: string): boolean {
  const asked = new URLSearchParams(search);
  return asked.get('test') === '1' && asked.get('net') === '1';
}

export type NetPanel = { render(meters: NetMeters | null, language: Language): void };

/** One line over the fight: the round trip, the input lead, corrections a second, the mean error and the snaps. */
export function createNetPanel(root: HTMLElement): NetPanel {
  const panel = el('p', { className: 'arena-net', attrs: { 'aria-hidden': 'true' } });
  root.append(panel);
  return {
    render: (meters, language) => {
      panel.hidden = meters === null;
      if (!meters) return;
      panel.textContent = format('arena.net', language, { rtt: Math.round(meters.rttMs), lead: meters.lead, corrections: meters.correctionsPerSecond, error: meters.meanError.toFixed(1), snaps: meters.snaps });
    },
  };
}
