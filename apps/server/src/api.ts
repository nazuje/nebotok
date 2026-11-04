import { CreateProfileRequest, LoginRequest, type ApiError, type ProfileError } from '@nebotok/core';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { Log } from './log.ts';
import type { ProfileStore, Result } from './profiles.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';

const STATUS: Readonly<Record<ProfileError, number>> = {
  nameInvalid: 400,
  pinInvalid: 400,
  pinWrong: 401,
  unknown: 404,
  nameTaken: 409,
  full: 409,
  locked: 423,
  busy: 429,
};

/** Generous for a family, tight for a script: per client address, per minute. */
export const API_LIMITS = { requests: 120, logins: 10, creates: 5 } as const;

function sendError(response: Response, error: ProfileError, retryAfterSeconds?: number, status: number = STATUS[error]): void {
  const body: ApiError = retryAfterSeconds === undefined ? { error } : { error, retryAfterSeconds };
  if (retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(retryAfterSeconds));
  response.status(status).json(body);
}

function sendResult<T>(response: Response, result: Result<T>, okStatus: number): void {
  if (result.ok) response.status(okStatus).json(result.value);
  else sendError(response, result.error, result.retryAfterSeconds);
}

function limited(limiter: RateLimiter, now: () => number): RequestHandler {
  return (request, response, next) => {
    const key = request.ip ?? 'unknown';
    if (limiter.take(key, now())) return next();
    return sendError(response, 'busy', limiter.retryAfterSeconds(key, now()));
  };
}

/**
 * State-changing requests must come from a page on this same address, as JSON. A page elsewhere can
 * neither name this origin nor send JSON across origins without a CORS preflight, which never succeeds
 * here because the API sends no CORS headers.
 */
const sameOriginJson: RequestHandler = (request, response, next) => {
  if (request.method === 'GET' || request.method === 'HEAD') return next();
  let origin: string | undefined;
  try {
    origin = new URL(request.get('origin') ?? '').host;
  } catch {
    origin = undefined;
  }
  if (!origin || origin !== request.host) return sendError(response, 'unknown', undefined, 403);
  if (request.method === 'POST' && !request.is('application/json')) return sendError(response, 'unknown', undefined, 415);
  return next();
};

function bearer(request: Request): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{1,100})$/.exec(request.get('authorization') ?? '');
  return match?.[1];
}

/**
 * The profile API under /api: list profiles, create one, log in and log out. Protocol details are
 * in docs/protocol.md.
 */
export function mountApi(app: express.Application, { profiles, now, log }: { profiles: ProfileStore; now: () => number; log: Log }): void {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(limited(createRateLimiter({ limit: API_LIMITS.requests, windowMs: 60_000 }), now));
  router.use(sameOriginJson);
  router.use(express.json({ limit: '1kb', strict: true }));

  router.get('/profiles', (_request, response) => {
    response.json(profiles.list());
  });

  router.post('/profiles', limited(createRateLimiter({ limit: API_LIMITS.creates, windowMs: 60_000 }), now), (request, response, next) => {
    const parsed = CreateProfileRequest.safeParse(request.body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return sendError(response, field === 'name' ? 'nameInvalid' : field === 'pin' ? 'pinInvalid' : 'unknown', undefined, 400);
    }
    return profiles.create(parsed.data).then((result) => {
      if (result.ok) log.info('profile created', { profileId: result.value.id });
      return sendResult(response, result, 201);
    }, next);
  });

  router.post('/sessions', limited(createRateLimiter({ limit: API_LIMITS.logins, windowMs: 60_000 }), now), (request, response, next) => {
    const parsed = LoginRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(response, parsed.error.issues[0]?.path[0] === 'pin' ? 'pinInvalid' : 'unknown', undefined, 400);
    }
    const { profileId } = parsed.data;
    return profiles.login(parsed.data).then((result) => {
      if (result.ok) log.info('logged in', { profileId });
      else log.info('login refused', { profileId, reason: result.error });
      return sendResult(response, result, 200);
    }, next);
  });

  router.delete('/sessions/current', (request, response) => {
    profiles.logout(bearer(request));
    response.status(204).end();
  });

  router.use((_request, response) => sendError(response, 'unknown', undefined, 404));
  // Express recognises an error handler by its four parameters.
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    if (status >= 500) log.error('api request failed', { error });
    sendError(response, 'unknown', undefined, status >= 400 && status < 500 ? status : 500);
  });
  app.use('/api', router);
}
