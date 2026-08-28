import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express from 'express';
import extractionRoute, { resetExtractionRateLimitForTests } from '../extractionRoute';
import { getFirebaseAdmin } from '../firebaseAdmin';
import { MAX_RECEIPT_ITEMS } from '../../domain/schema';

const app = express();
app.use('/api', extractionRoute);
const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2Nk+M/wHwAF/gL+BlFJ3wAAAABJRU5ErkJggg==', 'base64');

describe('Extraction Route Contract Tests', () => {
  afterEach(() => {
    mock.restoreAll();
    resetExtractionRateLimitForTests();
  });

  test('Missing Authorization header returns 401', async () => {
    const res = await request(app)
      .post('/api/extract')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), 'test.jpg');
    
    assert.strictEqual(res.status, 401);
  });

  test('rejects an unauthenticated multipart upload before file parsing', async () => {
    const res = await request(app)
      .post('/api/extract')
      .attach('receiptImage', Buffer.from('not an image'), { filename: 'upload.txt', contentType: 'text/plain' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
  });

  const mockAuthSuccess = () => {
    mock.method(getFirebaseAdmin().auth, 'verifyIdToken', () => Promise.resolve({ uid: '123' }));
  };

  test('Missing Gemini key returns 401 with MISSING_GEMINI_KEY code', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'MISSING_GEMINI_KEY');
  });

  test('Passing Gemini key in header instead of body is rejected with MISSING_GEMINI_KEY', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .set('x-gemini-key', 'deprecated-header-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'MISSING_GEMINI_KEY');
  });

  test('Invalid MIME type returns 400', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.txt', contentType: 'text/plain' });
    
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Unsupported image format/);
  });

  test('rejects a file whose content does not match the declared image MIME type', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('not an image'), { filename: 'test.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'BAD_REQUEST');
    assert.strictEqual(res.body.error, 'Invalid image file');
  });

  test('rejects a counterfeit PNG that has only the correct magic prefix', async () => {
    mockAuthSuccess();
    const counterfeitPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(1024, 0x41),
    ]);
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', counterfeitPng, { filename: 'counterfeit.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid image file');
  });

  test('rate limits authenticated extraction attempts before multipart parsing', async () => {
    mockAuthSuccess();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const res = await request(app)
        .post('/api/extract')
        .set('Authorization', 'Bearer valid-token');
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'BAD_REQUEST');
    }

    const blocked = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token');
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
    assert.match(String(blocked.headers['retry-after']), /^\d+$/);
  });

  test('Expired Firebase token returns 401', async () => {
    mock.method(getFirebaseAdmin().auth, 'verifyIdToken', () => Promise.reject(new Error('auth/id-token-expired')));
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer expired-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    
    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Invalid or expired/);
  });

  test('Secret redaction in error messages', async () => {
    mockAuthSuccess();
    const syntheticKey = `AIza${'x'.repeat(48)}`;
    const logs: string[] = [];
    mock.method(console, 'log', (message: unknown) => { logs.push(String(message)); });
    mock.method(global, 'fetch', () => Promise.reject(new Error(`Failed for key ${syntheticKey}`)));
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });
    
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'Upstream provider error');
    assert.doesNotMatch(res.body.error, /AIza/);
    assert.doesNotMatch(logs.join('\n'), /AIza/);
  });

  test('Non-receipt detection response', async () => {
    mockAuthSuccess();
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: false,
              documentWarnings: ['Image does not appear to be a receipt or financial transaction document.'],
              merchantRaw: null,
              items: [],
              rawOcrText: 'A landscape photograph of mountains',
              overallConfidence: 0.1
            })
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReceipt, false);
    assert.strictEqual(res.body.documentWarnings.length, 1);
  });

  test('Normal receipt structure', async () => {
    mockAuthSuccess();
    
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: true,
              merchantRaw: 'Imtiaz Super Market',
              currency: 'PKR',
              items: [{ rawLineText: 'Lipton Yellow Label 380g', confidence: 0.95, warnings: [] }],
              overallConfidence: 0.9,
              documentWarnings: [],
              rawOcrText: 'Imtiaz\nLipton Yellow Label 380g',
              ambiguousFields: []
            })
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReceipt, true);
    assert.strictEqual(res.body.merchantRaw, 'Imtiaz Super Market');
    assert.strictEqual(res.body.items.length, 1);
  });

  test('Unreadable values (nulls)', async () => {
    mockAuthSuccess();
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: true,
              merchantRaw: null,
              transactionDateCandidate: null,
              documentWarnings: ['Merchant name unreadable'],
              items: [],
              rawOcrText: 'BLURRY TEXT',
              overallConfidence: 0.2,
              ambiguousFields: ['merchantRaw']
            })
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.merchantRaw, null);
    assert.strictEqual(res.body.documentWarnings[0], 'Merchant name unreadable');
  });

  test('returns the canonical receipt DTO for Gemini nulls and extraction metadata', async () => {
    mockAuthSuccess();
    mock.method(global, 'fetch', () => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: true,
              documentWarnings: ['Several fields were unreadable'],
              merchantRaw: null,
              merchantNormalizedSuggestion: null,
              branchAddress: null,
              receiptNumber: null,
              transactionDateCandidate: null,
              transactionTimeCandidate: null,
              dateInterpretationNote: null,
              currency: 'PKR',
              paymentMethodCandidate: null,
              items: [{
                rawLineText: 'BLURRY LINE',
                name: null,
                brand: null,
                quantity: null,
                unit: null,
                unitPrice: null,
                discount: null,
                lineTotal: null,
                categorySuggestion: null,
                confidence: 0.2,
                warnings: ['Item details unreadable'],
              }],
              printedSubtotal: null,
              printedDiscount: null,
              printedTax: null,
              printedFees: null,
              printedRounding: null,
              printedGrandTotal: null,
              rawOcrText: 'BLURRY LINE',
              overallConfidence: 0.2,
              ambiguousFields: ['merchantRaw'],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.merchantRaw, null);
    assert.strictEqual(res.body.merchantNormalized, null);
    assert.strictEqual(res.body.items[0].name, null);
    assert.strictEqual(res.body.items[0].category, null);
    assert.strictEqual(res.body.items[0].unitPrice, null);
    assert.strictEqual(res.body.items[0].userEdited, false);
    assert.strictEqual(typeof res.body.items[0].id, 'string');
    assert.strictEqual(res.body.extractionSchemaVersion, '2');
    assert.strictEqual(typeof res.body.extractionModel, 'string');
    assert.strictEqual(typeof res.body.extractionDurationMs, 'number');
    assert.ok(!('categorySuggestion' in res.body.items[0]));
  });

  test('truncates an over-limit Gemini result with a review warning', async () => {
    mockAuthSuccess();
    const items = Array.from({ length: MAX_RECEIPT_ITEMS + 1 }, (_, index) => ({
      rawLineText: `Item ${index}`,
      name: `Item ${index}`,
      brand: null,
      quantity: 1,
      unit: null,
      unitPrice: '1.00',
      discount: null,
      lineTotal: '1.00',
      categorySuggestion: null,
      confidence: 0.9,
      warnings: [],
    }));
    mock.method(global, 'fetch', () => Promise.resolve(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        isReceipt: true,
        documentWarnings: [],
        items,
        rawOcrText: 'Long receipt',
        overallConfidence: 0.9,
        ambiguousFields: [],
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, MAX_RECEIPT_ITEMS);
    assert.ok(res.body.warnings.some((warning: string) => warning.includes(`supports up to ${MAX_RECEIPT_ITEMS} items`)));
  });

  test('Handles malformed JSON from upstream safely', async () => {
    mockAuthSuccess();
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: '{ malformed json: true, unclosed '
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'BAD_GATEWAY');
  });

  test('Handles upstream 429 quota exhaustion gracefully', async () => {
    mockAuthSuccess();
    mock.method(global, 'fetch', () => Promise.reject(new Error('Resource has been exhausted (e.g. check quota) 429')));

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.body.code, 'QUOTA_EXCEEDED');
  });

  test('Sends store: false explicitly', async () => {
    mockAuthSuccess();
    
    const mockFetch = mock.fn(() => {
      return Promise.resolve(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                isReceipt: true,
                items: [],
                overallConfidence: 0.9,
                rawOcrText: ''
              })
            }]
          }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    mock.method(global, 'fetch', mockFetch);
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });
      
    assert.strictEqual(res.status, 200);
  });

  test('Gracefully degrades malformed amount fields instead of 500', async () => {
    mockAuthSuccess();
    
    const mockFetch = mock.fn(() => {
      return Promise.resolve(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                isReceipt: true,
                merchantRaw: 'Al-Fatah',
                currency: 'PKR',
                items: [
                  { 
                    rawLineText: 'Milk 1L', 
                    unitPrice: '1,55,0', // Malformed comma formatting
                    lineTotal: '250/-',  // Handled properly by /- tolerance
                    confidence: 0.9, 
                    warnings: [] 
                  },
                  {
                    rawLineText: 'Eggs Dozen',
                    lineTotal: 'INVALID_AMOUNT_$$$', // Completely unparseable
                    confidence: 0.8,
                    warnings: []
                  }
                ],
                printedSubtotal: 'not-a-number',
                printedGrandTotal: '1,500/-',
                overallConfidence: 0.9,
                documentWarnings: [],
                rawOcrText: 'Milk 1L ... Eggs Dozen',
                ambiguousFields: []
              })
            }]
          }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    mock.method(global, 'fetch', mockFetch);
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', VALID_PNG, { filename: 'test.png', contentType: 'image/png' });
      
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReceipt, true);
    // Malformed unitPrice degraded to null with warning
    assert.strictEqual(res.body.items[0].unitPrice, null);
    assert.strictEqual(res.body.items[0].lineTotal, 25000);
    assert.ok(res.body.items[0].warnings.some((w: string) => w.includes('Could not parse amount: 1,55,0')));
    // Unparseable lineTotal degraded to null with warning
    assert.strictEqual(res.body.items[1].lineTotal, null);
    assert.ok(res.body.items[1].warnings.some((w: string) => w.includes('Could not parse amount: INVALID_AMOUNT_$$$')));
    // Malformed subtotal degraded to null with document warning
    assert.strictEqual(res.body.printedSubtotal, null);
    assert.strictEqual(res.body.printedGrandTotal, 150000);
    assert.ok(res.body.documentWarnings.some((w: string) => w.includes('Could not parse amount: not-a-number')));
  });
});
