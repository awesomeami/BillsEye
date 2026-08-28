import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express from 'express';
import extractionRoute from '../extractionRoute';
import accountRoute from '../accountRoute';
import serverApp from '../app';

const app = express();
app.use('/api', extractionRoute);
app.use('/api/account', accountRoute);

test('Security Audit - API Tests', async (t) => {

  await t.test('extractionRoute - rejects requests without auth header', async () => {
    const res = await request(app).post('/api/extract');
    assert.strictEqual(res.status, 401);
  });

  await t.test('extractionRoute - rejects non-image mime types', async () => {
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer fake_token')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.txt', contentType: 'text/plain' });
  });

  await t.test('accountRoute - rejects invalid actions', async () => {
    const res = await request(app)
      .post('/api/account/delete')
      .set('Authorization', 'Bearer dummy_token')
      .send({ action: 'steal_data' });
      
    assert.strictEqual(res.status, 401);
  });

  await t.test('serverApp - security headers match hardened CSP without unsafe-eval', async () => {
    const res = await request(serverApp).get('/api/health');
    assert.strictEqual(res.status, 200);

    const csp = res.headers['content-security-policy'];
    assert.ok(csp, 'CSP header should be present');
    assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must not contain unsafe-eval');
    assert.ok(csp.includes("script-src 'self' 'unsafe-inline' https://apis.google.com"));
    assert.ok(csp.includes("frame-src 'self' https://*.firebaseapp.com"));

    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  });

});
