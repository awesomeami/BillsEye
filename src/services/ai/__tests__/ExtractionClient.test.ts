import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readExtractionErrorResponse } from '../extractionErrors';

describe('ExtractionClient error responses', () => {
  test('reads a non-JSON platform error body exactly once and preserves status context', async () => {
    const response = new Response('<html>Bad gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });

    const parsed = await readExtractionErrorResponse(response);
    assert.strictEqual(parsed.message, 'Extraction service returned an error.');
    assert.strictEqual(parsed.code, undefined);
    assert.strictEqual(response.bodyUsed, true);
  });

  test('retains the structured code and provider retry interval', async () => {
    const response = new Response(JSON.stringify({
      error: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED',
      retryAfter: 7,
    }), {
      status: 429,
      headers: { 'Retry-After': '20' },
    });

    const parsed = await readExtractionErrorResponse(response, 1000);
    assert.deepStrictEqual(parsed, {
      message: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED',
      retryAfterMs: 7000,
    });
  });

  test('falls back to an HTTP-date Retry-After header', async () => {
    const now = Date.parse('2026-09-02T12:00:00.000Z');
    const response = new Response(JSON.stringify({
      error: 'Please wait',
      code: 'RATE_LIMITED',
    }), {
      status: 429,
      headers: { 'Retry-After': 'Wed, 02 Sep 2026 12:00:05 GMT' },
    });

    const parsed = await readExtractionErrorResponse(response, now);
    assert.strictEqual(parsed.retryAfterMs, 5000);
  });
});
