import path from 'path';
import { createServer } from 'node:http';
import express from 'express';
import { createServer as createViteServer, loadEnv } from 'vite';
import apiApp from './src/server/app';
import { mountProductionClient } from './src/server/clientAssets';

function getPort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000;
}

export const createProductionServer = () => {
  const app = express();
  const httpServer = createServer(app);
  const isProduction = process.env.NODE_ENV === 'production';

  // Vite reads .env.local for client values itself. Load the same local file
  // into the Node process so the local API can read its server-only Firebase
  // variables without adding another dotenv dependency.
  if (!isProduction) {
    Object.assign(process.env, loadEnv('development', process.cwd(), ''));
  }

  const PORT = getPort(process.env.PORT);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    app = express();
    app.use(apiApp);
  if (!isProduction) {
    const vite = await createViteServer({
      // Middleware mode does not attach its own HTTP upgrade listener. Give
      // Vite the Express server so React Fast Refresh can use the same port.
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    // Vite injects a small inline React-refresh bootstrap into development
    // HTML. Keep the API's strict production CSP on API responses, but let
    // Vite serve non-API development requests without that API-only header.
    app.use((req, res, next) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        return apiApp(req, res, next);
      }

      // Versions of this server before the development route split cached an
      // HTML CSP that blocks Vite's refresh bootstrap. A 304 retains that
      // stale policy, so always send a fresh development document instead.
      if (req.headers.accept?.includes('text/html')) {
        delete req.headers['if-none-match'];
      }

      return vite.middlewares(req, res, next);
    });
  } else {
    app = createProductionServer();
    app.use(apiApp);
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // The API is mounted before this route. Every other GET is a client-side
    // route and must receive the SPA entry point rather than a 404.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
