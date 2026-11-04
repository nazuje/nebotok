import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PROTOCOL_VERSION } from '@nebotok/core';
import express, { type Application, type Response } from 'express';
import pkg from '../package.json' with { type: 'json' };
import type { Config } from './config.ts';
import type { Log } from './log.ts';

export const SERVER_VERSION: string = pkg.version;

export type Health = { readonly ok: true; readonly protocol: number; readonly version: string };

export function health(): Health {
  return { ok: true, protocol: PROTOCOL_VERSION, version: SERVER_VERSION };
}

const LONG_CACHE = 'public, max-age=31536000, immutable';
const ALWAYS_CHECK = 'no-cache';

/**
 * Vite names everything under assets/ by content hash, so those never change under a name. Every
 * other file (index.html, the service worker, the manifest, icons) keeps its name across releases.
 */
export function cacheControlFor(pathInDist: string): string {
  const parts = pathInDist.split(sep).join('/').split('/');
  return parts[0] === 'assets' ? LONG_CACHE : ALWAYS_CHECK;
}

/** Keeps the page to its own origin: no outside scripts, fonts, images or connections. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function mountHttp(app: Application, config: Config, log: Log): void {
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json(health());
  });

  if (!config.production) return;
  if (!existsSync(join(config.gameDist, 'index.html'))) {
    throw new Error(`no built game in ${config.gameDist}; run npm run build first`);
  }
  app.use(
    express.static(config.gameDist, {
      index: 'index.html',
      setHeaders: (response: Response, filePath: string) => {
        response.setHeader('Cache-Control', cacheControlFor(relative(config.gameDist, filePath)));
        response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
      },
    }),
  );
  log.info('serving the game', { dir: config.gameDist });
}
