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

function getViteMode(): string {
  return process.argv.includes('--e2e') ? 'e2e' : 'development';
}

export const createProductionServer = (): express.Express => {
  const app = express();
  app.use(apiApp);
  mountProductionClient(app, path.join(process.cwd(), 'dist'));
  return app;
};

async function startServer(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const mode = isProduction ? 'production' : getViteMode();

  // Vite reads local env files for client configuration. Mirror the selected
  // mode into Node so the local API validates only explicit Admin settings.
  if (!isProduction) {
    Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  }

  const port = getPort(process.env.PORT);
  if (isProduction) {
    const app = createProductionServer();
    createServer(app).listen(port, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${port}`);
    });
    return;
  }

  const app = express();
  const httpServer = createServer(app);
  const vite = await createViteServer({
    mode,
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
    },
    appType: 'spa',
  });

  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return apiApp(req, res, next);
    }

    if (req.headers.accept?.includes('text/html')) {
      delete req.headers['if-none-match'];
    }
    return vite.middlewares(req, res, next);
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
