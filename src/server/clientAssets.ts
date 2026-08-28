import path from 'node:path';
import type { RequestHandler } from 'express';
import express from 'express';

const ROOT_CLIENT_ASSETS = new Set([
  '/manifest.webmanifest',
  '/registerSW.js',
  '/sw.js',
  '/google-logo.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
]);

const ASSET_FILE = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:css|gif|ico|jpe?g|js|mjs|png|svg|webp|avif|woff2?)$/;
const WORKBOX_FILE = /^\/workbox-[A-Za-z0-9_-]+\.js$/;
const FORBIDDEN_EXTENSION = /\.(?:cjs|map|ts|tsx)$/i;

/** Deny deployment artifacts before the SPA fallback can turn them into 200s. */
export const isForbiddenArtifactPath = (pathname: string): boolean => {
  // Encoded paths are never allowlisted client assets. Reject them before
  // canonicalization so double-encoding cannot reach the SPA fallback.
  if (pathname.includes('%')) return true;

  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot be a valid client asset and must not reach the SPA fallback.
    return true;
  }
  const normalized = decodedPathname.toLowerCase();
  const segments = normalized.split('/').filter(Boolean);

  return segments.some((segment) => segment === 'dist' || segment === 'dist-server' || segment.startsWith('.env'))
    || FORBIDDEN_EXTENSION.test(normalized)
    || normalized.endsWith('/server.js')
    || normalized.endsWith('/server.mjs')
    || normalized.endsWith('/server.cjs');
};

export const isAllowedClientAssetPath = (pathname: string): boolean => (
  ROOT_CLIENT_ASSETS.has(pathname) || ASSET_FILE.test(pathname) || WORKBOX_FILE.test(pathname)
);

export const createClientAssetMiddleware = (clientDistPath: string): RequestHandler => {
  const resolvedClientDistPath = path.resolve(clientDistPath);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    if (isForbiddenArtifactPath(req.path)) {
      res.sendStatus(404);
      return;
    }

    if (!isAllowedClientAssetPath(req.path)) {
      next();
      return;
    }

    const relativeAssetPath = req.path.slice(1);
    res.sendFile(relativeAssetPath, { root: resolvedClientDistPath, dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) {
        res.sendStatus(404);
      }
    });
  };
};

export const createClientSpaFallback = (clientDistPath: string): RequestHandler => {
  const resolvedClientDistPath = path.resolve(clientDistPath);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    if (isForbiddenArtifactPath(req.path) || path.posix.extname(req.path) !== '') {
      res.sendStatus(404);
      return;
    }

    res.sendFile('index.html', { root: resolvedClientDistPath, dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) {
        res.sendStatus(404);
      }
    });
  };
};

export const mountProductionClient = (app: express.Express, clientDistPath: string): void => {
  app.use(createClientAssetMiddleware(clientDistPath));
  app.use(createClientSpaFallback(clientDistPath));
};
