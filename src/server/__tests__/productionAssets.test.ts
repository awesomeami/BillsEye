import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import apiApp from '../app';
import { mountProductionClient } from '../clientAssets';

const productionApp = express();
productionApp.use(apiApp);
mountProductionClient(productionApp, path.join(process.cwd(), 'dist'));

test('production serving returns 404 for server and source artifacts', async () => {
  const forbiddenPaths = [
    '/.env',
    '/.env.production',
    '/%2eenv',
    '/%252eenv',
    '/%zz',
    '/server.ts',
    '/server.cjs',
    '/server%2ecjs',
    '/server.cjs.map',
    '/assets/server.cjs',
    '/assets/main.js.map',
    '/dist/server.cjs',
    '/dist-server/server.cjs',
  ];

  for (const forbiddenPath of forbiddenPaths) {
    const response = await request(productionApp).get(forbiddenPath);
    assert.strictEqual(response.status, 404, forbiddenPath);
  }
});
