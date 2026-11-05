import { createRouter, matchMaker } from '@colyseus/core';

/** Join options are a protocol number and a language, far below this. */
export const MATCHMAKE_BODY_LIMIT = 1_024;

/**
 * Colyseus sends CORS headers on every response, echoing the caller's Origin with
 * `Allow-Credentials: true`, so any page a player visits could join the world as them and read the
 * answer. Like /api, the server sends none: the game page is on this same origin and needs none.
 */
export function closeMatchmakeCors(): void {
  const { controller } = matchMaker;
  for (const header of Object.keys(controller.DEFAULT_CORS_HEADERS)) Reflect.deleteProperty(controller.DEFAULT_CORS_HEADERS, header);
  controller.getCorsHeaders = () => ({});
}

/**
 * Runs before Colyseus reads a matchmaking body, which it otherwise does without a size limit. The
 * body stream itself stops at the declared Content-Length, so a body without one is refused.
 */
function limitBody(request: Request): Response | undefined {
  if (request.method !== 'POST') return undefined;
  const length = request.headers.get('content-length');
  if (length === null) return Response.json({ error: 'length required' }, { status: 411 });
  if (!(Number(length) <= MATCHMAKE_BODY_LIMIT)) return Response.json({ error: 'request body too large' }, { status: 413 });
  return undefined;
}

/** The router Colyseus adds its /matchmake routes to. */
export function matchmakeRoutes() {
  return createRouter({}, { onRequest: limitBody });
}
