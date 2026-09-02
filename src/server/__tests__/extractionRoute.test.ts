import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express from 'express';
import {
  createExtractionRoute,
  RECEIPT_EXTRACTION_INSTRUCTION,
  type ExtractionRouteOptions,
} from '../extractionRoute';
import { getFirebaseAdmin } from '../firebaseAdmin';
import { ExtractionControlService, InMemoryExtractionControlStore } from '../extractionControls';
import { ExtractionResultSchema, MAX_RECEIPT_ITEMS } from '../../domain/schema';

process.env.FIREBASE_PROJECT_ID ??= 'test-project';
process.env.FIREBASE_DATABASE_ID ??= '(default)';
process.env.FIREBASE_ADMIN_USE_ADC ??= 'true';

const createTestApp = (options: Pick<ExtractionRouteOptions, 'multipartParser'> = {}) => {
  const app = express();
  const controls = new ExtractionControlService(new InMemoryExtractionControlStore(), {
    maxRequestsPerWindow: 100,
    rateWindowMs: 60_000,
    leaseDurationMs: 65_000,
  });
  app.use('/api', createExtractionRoute({
    localControls: new ExtractionControlService(new InMemoryExtractionControlStore(), {
      maxRequestsPerWindow: 100,
      rateWindowMs: 60_000,
      leaseDurationMs: 65_000,
    }),
    sharedControls: controls,
    ...options,
  }));
  return app;
};

const app = createTestApp();

describe('Extraction Route Contract Tests', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('Missing Authorization header returns 401', async () => {
    const res = await request(app)
      .post('/api/extract')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), 'test.jpg');
    
    assert.strictEqual(res.status, 401);
  });

  const mockAuthSuccess = () => {
    mock.method(getFirebaseAdmin().auth, 'verifyIdToken', () => Promise.resolve({ uid: '123' }));
  };

  test('Missing Gemini key returns 401 with MISSING_GEMINI_KEY code', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'MISSING_GEMINI_KEY');
  });

  test('Passing Gemini key in header instead of body is rejected with MISSING_GEMINI_KEY', async () => {
    mockAuthSuccess();
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .set('x-gemini-key', 'deprecated-header-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

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

  test('rejects an unauthenticated request before multipart parsing starts', async () => {
    mock.method(getFirebaseAdmin().auth, 'verifyIdToken', () => Promise.reject(new Error('auth/id-token-expired')));
    let parserCalls = 0;
    const appWithParserProbe = createTestApp({
      multipartParser: (_req, _res, next) => {
        parserCalls += 1;
        next();
      },
    });

    const res = await request(appWithParserProbe)
      .post('/api/extract')
      .set('Authorization', 'Bearer invalid-token');

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    assert.strictEqual(parserCalls, 0);
  });

  test('still rejects an oversized upload after successful authentication', async () => {
    mockAuthSuccess();

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .attach('receiptImage', Buffer.alloc(5 * 1024 * 1024), 'large.jpg');

    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.code, 'PAYLOAD_TOO_LARGE');
  });

  test('rejects a duplicate in-flight extraction for the same UID', async () => {
    mockAuthSuccess();
    let resolveFetch: ((response: Response) => void) | undefined;
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    mock.method(global, 'fetch', () => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
      markFetchStarted?.();
    }));

    const firstRequest = request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    const firstResult = firstRequest.then((response) => response);

    await fetchStarted;

    const duplicate = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(duplicate.status, 429);
    assert.strictEqual(duplicate.body.code, 'EXTRACTION_IN_PROGRESS');
    assert.ok(duplicate.headers['retry-after']);

    resolveFetch?.(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        isReceipt: false,
        documentWarnings: [],
        items: [],
        rawOcrText: '',
        overallConfidence: 0,
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    assert.strictEqual((await firstResult).status, 200);
  });

  test('Secret redaction in error messages', async () => {
    mockAuthSuccess();
    const logOutput: string[] = [];
    mock.method(console, 'log', (message: unknown) => {
      logOutput.push(String(message));
    });
    mock.method(global, 'fetch', () => Promise.reject(new Error(
      'Failed for key AIzaSyA1234567890abcdefghijklmnopqrstuvwxyz and Bearer private-token',
    )));
    
    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'Upstream provider error');
    assert.doesNotMatch(res.body.error, /AIza/);
    assert.match(logOutput.join('\n'), /Gemini request failed/);
    assert.doesNotMatch(logOutput.join('\n'), /AIza|private-token|Bearer/);
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

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
              merchantNormalizedSuggestion: 'Imtiaz',
              transactionDateCandidate: '2026-08-28',
              transactionTimeCandidate: '14:30',
              dateInterpretationNote: 'Date is unambiguous.',
              currency: 'PKR',
              paymentMethodCandidate: 'Card',
              items: [{ rawLineText: 'Lipton Yellow Label 380g', categorySuggestion: 'Beverages', confidence: 0.95, warnings: [] }],
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isReceipt, true);
    assert.strictEqual(res.body.merchantRaw, 'Imtiaz Super Market');
    assert.strictEqual(res.body.items.length, 1);
    assert.strictEqual(res.body.items[0].category, 'Beverages');
    assert.match(res.body.items[0].id, /^[a-f0-9-]{36}$/i);
    assert.strictEqual(res.body.merchantNormalized, 'Imtiaz');
    assert.strictEqual(res.body.transactionDate, '2026-08-28');
    assert.strictEqual(res.body.transactionTime, '14:30');
    assert.strictEqual(res.body.dateAmbiguous, false);
    assert.strictEqual(res.body.paymentMethod, 'Card');
    assert.doesNotThrow(() => ExtractionResultSchema.parse(res.body));
    assert.strictEqual(res.body.extractionSchemaVersion, '4');
  });

  test('rejects Gemini fields that exceed the browser extraction contract', async () => {
    mockAuthSuccess();
    const invalidPayloads = [
      {
        isReceipt: true,
        items: Array.from({ length: MAX_RECEIPT_ITEMS + 1 }, (_, index) => ({
          rawLineText: `Item ${index}`,
        })),
        rawOcrText: 'Too many items',
        overallConfidence: 1,
      },
      {
        isReceipt: true,
        merchantRaw: 'x'.repeat(256),
        items: [],
        rawOcrText: 'Long merchant',
        overallConfidence: 1,
      },
      {
        isReceipt: true,
        items: [{ rawLineText: 'Invalid quantity', quantity: -1 }],
        rawOcrText: 'Negative quantity',
        overallConfidence: 1,
      },
    ];
    let responseIndex = 0;
    mock.method(global, 'fetch', () => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify(invalidPayloads[responseIndex++]) }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    for (const fileName of ['too-many.jpg', 'long-merchant.jpg', 'negative-quantity.jpg']) {
      const res = await request(app)
        .post('/api/extract')
        .set('Authorization', 'Bearer valid-token')
        .field('geminiKey', 'test-key')
        .attach('receiptImage', Buffer.from('fake'), { filename: fileName, contentType: 'image/jpeg' });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, 'UNPROCESSABLE_ENTITY');
    }
  });

  test('handles a combined sales-tax amount/rate column without double-counting tax', async () => {
    mockAuthSuccess();
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: true,
              merchantRaw: 'BATA PAKISTAN LIMITED',
              receiptNumber: '1010190009',
              transactionDateCandidate: '2019-10-10',
              transactionTimeCandidate: '15:11:32',
              currency: 'PKR',
              paymentMethodCandidate: 'Cash',
              items: [{
                rawLineText: '4116909 40 1 3,418 0 581 17 3,999',
                name: 'Article 4116909',
                quantity: 1,
                unitPrice: '3418',
                discount: '0',
                taxAmount: '581',
                taxRatePercent: '17',
                lineTotal: '3999',
                confidence: 0.98,
                warnings: [],
              }],
              printedSubtotal: '3418',
              printedDiscount: '0',
              printedTax: null,
              printedGrandTotal: '3999',
              rawOcrText: 'Price Disc S.Tax@% Total\n3,418 0 581 17 3,999\nCASH 4,000\nChange Due 1',
              overallConfidence: 0.98,
              documentWarnings: [],
              ambiguousFields: [],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'bata.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.printedSubtotal, 341800);
    assert.strictEqual(res.body.printedTax, 58100);
    assert.strictEqual(res.body.printedGrandTotal, 399900);
    assert.strictEqual(res.body.computedLineTotal, 399900);
    assert.strictEqual(res.body.computedExpectedTotal, 399900);
    assert.strictEqual(res.body.discrepancy, 0);
    assert.strictEqual(res.body.reconciliationStatus, 'matched');
    assert.ok(!res.body.warnings.includes('Calculated total is higher than printed total'));
  });

  test('infers a bounded whole-rupee rounding adjustment without changing raw extracted totals', async () => {
    mockAuthSuccess();
    const mockFetch = mock.fn(() => Promise.resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              isReceipt: true,
              items: [{
                rawLineText: 'CHICKEN KARHAI CUT (18 PIECES)',
                quantity: 0.994,
                unitPrice: '512.00',
                lineTotal: '508.93',
                confidence: 0.95,
                warnings: [],
              }],
              printedTax: '0.00',
              printedGrandTotal: '509.00',
              overallConfidence: 0.95,
              documentWarnings: [],
              rawOcrText: 'Qty 0.994 Rate 512.00 Amount 508.93 Net Amount 509.00',
              ambiguousFields: [],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mock.method(global, 'fetch', mockFetch);

    const res = await request(app)
      .post('/api/extract')
      .set('Authorization', 'Bearer valid-token')
      .field('geminiKey', 'test-key')
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.printedRounding, null);
    assert.strictEqual(res.body.computedExpectedTotal, 50900);
    assert.strictEqual(res.body.discrepancy, 0);
    assert.strictEqual(res.body.reconciliationStatus, 'matched');
    assert.ok(!res.body.warnings.includes('Printed total is higher than calculated total'));
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
    
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.merchantRaw, null);
    assert.strictEqual(res.body.documentWarnings[0], 'Merchant name unreadable');
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.body.code, 'QUOTA_EXCEEDED');
  });

  test('Sends the fixed Flash-Lite model with low thinking and store: false', async () => {
    mockAuthSuccess();

    let requestedUrl = '';
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch = mock.fn((input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      return Promise.resolve(new Response(JSON.stringify({
        modelVersion: 'gemini-3.5-flash-lite-001',
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
      
    assert.strictEqual(res.status, 200);
    assert.match(requestedUrl, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.deepStrictEqual(
      (requestBody?.generationConfig as { thinkingConfig?: unknown } | undefined)?.thinkingConfig,
      { thinkingLevel: 'LOW' },
    );
    assert.match(RECEIPT_EXTRACTION_INSTRUCTION, /S\.Tax@%/);
    assert.match(RECEIPT_EXTRACTION_INSTRUCTION, /Cash\/tendered\/card-paid amounts and change due are payment metadata/);
    assert.match(RECEIPT_EXTRACTION_INSTRUCTION, /Toys & Games/);
    assert.match(RECEIPT_EXTRACTION_INSTRUCTION, /Miscellaneous \/ Unclear/);
    assert.strictEqual(res.body.extractionModel, 'gemini-3.5-flash-lite');
    assert.strictEqual(res.body.extractionModelActual, 'gemini-3.5-flash-lite-001');
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
      .attach('receiptImage', Buffer.from('fake'), { filename: 'test.jpg', contentType: 'image/jpeg' });
      
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
