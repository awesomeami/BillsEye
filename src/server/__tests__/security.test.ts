import { test, mock } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express from 'express';
import * as fs from 'node:fs';
import extractionRoute, { resetExtractionRateLimitForTests } from '../extractionRoute';
import accountRoute from '../accountRoute';
import serverApp from '../app';
import { getFirebaseAdmin } from '../firebaseAdmin';

const app = express();
app.use('/api', extractionRoute);
app.use('/api/account', accountRoute);

test('Security Audit - API Tests', async (t) => {
  t.afterEach(() => {
    mock.restoreAll();
    resetExtractionRateLimitForTests();
  });

  const mockAuthSuccess = () => {
    mock.method(getFirebaseAdmin().auth, 'verifyIdToken', () => Promise.resolve({ uid: 'security-test-user' }));
  };

  await t.test('extractionRoute - rejects requests without auth header', async () => {
    const res = await request(app).post('/api/extract');
    assert.strictEqual(res.status, 401);
  });

  await t.test('extractionRoute - rejects unauthenticated uploads before multipart parsing', async () => {
    const res = await request(app)
      .post('/api/extract')
      .attach('receiptImage', Buffer.from('not an image'), { filename: 'test.txt', contentType: 'text/plain' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
  });

  await t.test('extractionRoute - rejects authenticated oversized bodies with a safe error', async () => {
    mockAuthSuccess();
    // 5MB buffer
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024, 'a');
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer dummy_token')
      .attach('receiptImage', largeBuffer, { filename: 'test.png', contentType: 'image/png' });
      
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.code, 'PAYLOAD_TOO_LARGE');
  });

  await t.test('extractionRoute - rejects non-image mime types', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer fake_token')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.txt', contentType: 'text/plain' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'BAD_REQUEST');
  });

  await t.test('accountRoute - rejects invalid actions', async () => {
    const res = await request(app)
      .post('/api/account/delete')
      .set('Authorization', 'Bearer dummy_token')
      .send({ action: 'steal_data' });
      
    assert.strictEqual(res.status, 401);
  });

  await t.test('serverApp - security headers match the deployed hardened CSP', async () => {
    const res = await request(serverApp).get('/api/health');
    assert.strictEqual(res.status, 200);

    const csp = res.headers['content-security-policy'];
    assert.ok(csp, 'CSP header should be present');
    assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must not contain unsafe-eval');
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'CSP must not allow inline scripts');
    assert.ok(csp.includes("script-src 'self' https://apis.google.com"));
    assert.ok(csp.includes("frame-src 'self' https://*.firebaseapp.com"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes("form-action 'self'"));

    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  await t.test('vercel deploy headers retain the same framing and script restrictions', async () => {
    const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const globalHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)');
    const csp = globalHeaders?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;

    assert.ok(csp);
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes("script-src 'self' https://apis.google.com"));
    assert.ok(csp.includes("frame-src 'self' https://*.firebaseapp.com"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes("form-action 'self'"));
  });

});
