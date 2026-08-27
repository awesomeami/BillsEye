import { Router } from 'express';
import multer from 'multer';
import { getFirebaseAdmin } from './firebaseAdmin';
import { GoogleGenAI } from '@google/genai';
import { RECEIPT_EXTRACTION_MODEL, EXTRACTION_SCHEMA_VERSION } from './geminiConfig';
import { RawGeminiReceiptV2 } from '../domain/schema';
import { parseMajorToMinor } from '../domain/money';
import { reconcileReceipt } from '../domain/reconciliation';

const router = Router();

// Store only in memory, limit to ~4MB to be safe for Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }
});

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const generateRequestId = () => Math.random().toString(36).substring(2, 10);

const logSafe = (reqId: string, message: string, meta: any = {}) => {
  // Redact any potential keys or sensitive info
  const safeMeta = JSON.parse(JSON.stringify(meta));
  if (safeMeta.key) safeMeta.key = '[REDACTED]';
  if (safeMeta.geminiKey) safeMeta.geminiKey = '[REDACTED]';
  if (safeMeta.token) safeMeta.token = '[REDACTED]';
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), reqId, message, ...safeMeta }));
};

const extractRetryAfter = (headers: Headers): number | null => {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return null;
  const asNum = parseInt(retryAfter, 10);
  if (!isNaN(asNum)) return asNum;
  const asDate = Date.parse(retryAfter);
  if (!isNaN(asDate)) {
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return null;
};

router.post('/extract', (req, res, next) => {
  upload.single('receiptImage')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(413).json({ error: 'File too large', code: 'PAYLOAD_TOO_LARGE' });
      }
      return res.status(400).json({ error: 'Upload error', code: 'BAD_REQUEST' });
    }
    next();
  });
}, async (req, res) => {
  const reqId = generateRequestId();
  const startTime = Date.now();
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const ac = new AbortController();
  
  const onAbort = () => {
    logSafe(reqId, 'Client aborted request');
    ac.abort();
  };
  req.on('aborted', onAbort);

  // Set to 55s (5s below Vercel serverless function maxDuration of 60s)
  // to allow returning a graceful 504 JSON timeout response before Vercel kills the process.
  const timeoutId = setTimeout(() => {
    logSafe(reqId, 'Server-side timeout aborting request');
    ac.abort();
  }, 55000); // 55 seconds timeout

  try {
    // 1. Verify Authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      logSafe(reqId, 'Missing or invalid Authorization header');
      return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
      await getFirebaseAdmin().auth.verifyIdToken(token);
    } catch (e) {
      logSafe(reqId, 'Invalid or expired Firebase ID token');
      return res.status(401).json({ error: 'Invalid or expired Firebase ID token', code: 'UNAUTHORIZED' });
    }

    // 2. Validate Image
    const file = req.file;
    if (!file) {
      logSafe(reqId, 'Missing receipt image');
      return res.status(400).json({ error: 'Missing receipt image', code: 'BAD_REQUEST' });
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      logSafe(reqId, 'Unsupported image format');
      return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.', code: 'BAD_REQUEST' });
    }

    // 3. Extract Gemini Key from Request Body (multipart form field)
    const geminiKey = req.body?.geminiKey as string;
    if (!geminiKey) {
      logSafe(reqId, 'Missing Gemini API key in request body');
      return res.status(401).json({ error: 'Missing Gemini API key in request body', code: 'MISSING_GEMINI_KEY' });
    }

    // 4. Initialize SDK
    logSafe(reqId, 'Initializing GoogleGenAI');
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    // 5. Instruction & Schema
    const systemInstruction = `Act as a high-precision receipt transcription engine for Pakistani retail receipts, including English, Urdu, and Roman Urdu.
Extract only visible information. Never invent unreadable or absent values.
Return null plus a warning for missing/unreadable fields; never substitute zero.
Preserve raw text separately from normalized suggestions.
Recognize PKR, Rs/Rs., comma separators, decimals, weights, quantities, "2 x 150" patterns, and discounts.
Do not force item sums to match printed totals.
Use YYYY-MM-DD only when defensible; flag ambiguous day/month ordering.
Category suggestions are limited to the following or null: Groceries, Meat, Fruit & Vegetables, Household, Medicine, Eating Out, Miscellaneous.
Confidence reflects legibility/extraction certainty, not arithmetic agreement.
Return only the requested structured JSON result.`.trim();

    // 6. Call Gemini
    logSafe(reqId, 'Calling Gemini generateContent');
    let result;
    try {
      result = await ai.models.generateContent({
        model: RECEIPT_EXTRACTION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Extract data from this receipt according to instructions.' },
              {
                inlineData: {
                  data: file.buffer.toString('base64'),
                  mimeType: file.mimetype
                }
              }
            ]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          // Ensure it's not stored
          // @ts-expect-error - GenAI SDK missing store typings
          store: false,
          abortSignal: ac.signal,
          responseSchema: {
            type: 'object',
            properties: {
              isReceipt: { type: 'boolean' },
              documentWarnings: { type: 'array', items: { type: 'string' } },
              merchantRaw: { type: 'string', nullable: true },
              merchantNormalizedSuggestion: { type: 'string', nullable: true },
              branchAddress: { type: 'string', nullable: true },
              receiptNumber: { type: 'string', nullable: true },
              transactionDateCandidate: { type: 'string', nullable: true, description: 'YYYY-MM-DD' },
              transactionTimeCandidate: { type: 'string', nullable: true },
              dateInterpretationNote: { type: 'string', nullable: true },
              currency: { type: 'string', nullable: true },
              paymentMethodCandidate: { type: 'string', nullable: true },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    rawLineText: { type: 'string' },
                    name: { type: 'string', nullable: true },
                    brand: { type: 'string', nullable: true },
                    quantity: { type: 'number', nullable: true },
                    unit: { type: 'string', nullable: true },
                    unitPrice: { type: 'string', nullable: true, description: 'Decimal string major units' },
                    discount: { type: 'string', nullable: true, description: 'Decimal string major units' },
                    lineTotal: { type: 'string', nullable: true, description: 'Decimal string major units' },
                    categorySuggestion: { type: 'string', nullable: true, description: 'Groceries, Meat, Fruit & Vegetables, Household, Medicine, Eating Out, Miscellaneous' },
                    confidence: { type: 'number' },
                    warnings: { type: 'array', items: { type: 'string' } }
                  }
                }
              },
              printedSubtotal: { type: 'string', nullable: true, description: 'Decimal string major units' },
              printedDiscount: { type: 'string', nullable: true, description: 'Decimal string major units' },
              printedTax: { type: 'string', nullable: true, description: 'Decimal string major units' },
              printedFees: { type: 'string', nullable: true, description: 'Decimal string major units' },
              printedRounding: { type: 'string', nullable: true, description: 'Decimal string major units' },
              printedGrandTotal: { type: 'string', nullable: true, description: 'Decimal string major units' },
              rawOcrText: { type: 'string' },
              overallConfidence: { type: 'number' },
              ambiguousFields: { type: 'array', items: { type: 'string' } }
            },
            required: ['isReceipt', 'items', 'rawOcrText', 'overallConfidence']
          }
        }
      });
    } catch (e: any) {
      const errorMsg = e.message || '';
      logSafe(reqId, 'Gemini request failed', { errorMsg: errorMsg.replace(/AIza[a-zA-Z0-9-_]{35}/g, '[REDACTED_KEY]') });
      
      let retryAfterSeconds = null;
      if (e.response && e.response.headers) {
        retryAfterSeconds = extractRetryAfter(e.response.headers);
      }

      if (errorMsg.includes('abort') || ac.signal.aborted) {
        return res.status(504).json({ error: 'Request timeout or aborted', code: 'TIMEOUT' });
      }
      
      if (e.status === 429 || errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('resource has been exhausted')) {
        return res.status(429).json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED', retryAfter: retryAfterSeconds });
      }

      if (e.status === 401 || e.status === 403 || errorMsg.toLowerCase().includes('api key not valid') || errorMsg.toLowerCase().includes('api key expired')) {
        return res.status(403).json({ error: 'Invalid or unauthorized Gemini API key', code: 'GEMINI_KEY_REJECTED' });
      }
      
      return res.status(502).json({ error: 'Upstream provider error', code: 'UPSTREAM_ERROR' });
    }

    const text = result.text;
    if (!text) {
      logSafe(reqId, 'No text returned from Gemini');
      return res.status(502).json({ error: 'No text returned from Gemini', code: 'UPSTREAM_ERROR' });
    }
    
    // Parse JSON safely
    let parsedData;
    try {
        parsedData = JSON.parse(text);
    } catch (e) {
        logSafe(reqId, 'Failed to parse Gemini response as JSON');
        return res.status(502).json({ error: 'Failed to parse Gemini response as JSON', code: 'BAD_GATEWAY' });
    }
    
    // Validate raw with Zod
    let rawGeminiResult;
    try {
        rawGeminiResult = RawGeminiReceiptV2.parse(parsedData);
    } catch (e) {
        logSafe(reqId, "Zod Validation Error");
        return res.status(422).json({ error: 'Gemini response did not match expected schema', code: 'UNPROCESSABLE_ENTITY' });
    }

    if (!rawGeminiResult.isReceipt) {
        logSafe(reqId, 'Processed successfully but not a receipt');
        return res.status(200).json({ 
           isReceipt: false, 
           documentWarnings: rawGeminiResult.documentWarnings || ['Image does not appear to be a receipt']
        });
    }

    // Convert decimal strings to minor units deterministically with graceful error degradation
    const parsedItems = rawGeminiResult.items.map(item => {
      const itemWarnings = [...(item.warnings || [])];

      const safeParseItemAmount = (val: string | null | undefined): number | null => {
        if (val === null || val === undefined || val.trim() === '') {
          return null;
        }
        try {
          return parseMajorToMinor(val);
        } catch {
          itemWarnings.push(`Could not parse amount: ${val}`);
          return null;
        }
      };

      return {
        ...item,
        unitPrice: safeParseItemAmount(item.unitPrice),
        discount: safeParseItemAmount(item.discount),
        lineTotal: safeParseItemAmount(item.lineTotal),
        warnings: itemWarnings,
      };
    });

    const docWarnings = [...rawGeminiResult.documentWarnings];
    const safeParseTotalAmount = (val: string | null | undefined): number | null => {
      if (val === null || val === undefined || val.trim() === '') {
        return null;
      }
      try {
        return parseMajorToMinor(val);
      } catch {
        docWarnings.push(`Could not parse amount: ${val}`);
        return null;
      }
    };

    const parsedTotals = {
      printedSubtotal: safeParseTotalAmount(rawGeminiResult.printedSubtotal),
      printedDiscount: safeParseTotalAmount(rawGeminiResult.printedDiscount),
      printedTax: safeParseTotalAmount(rawGeminiResult.printedTax),
      printedFees: safeParseTotalAmount(rawGeminiResult.printedFees),
      printedRounding: safeParseTotalAmount(rawGeminiResult.printedRounding),
      printedGrandTotal: safeParseTotalAmount(rawGeminiResult.printedGrandTotal)
    };
    
    const reconciliation = reconcileReceipt(parsedItems, parsedTotals);
    const extractionDurationMs = Date.now() - startTime;
    
    const finalDto = {
      isReceipt: true,
      merchantRaw: rawGeminiResult.merchantRaw,
      merchantNormalizedSuggestion: rawGeminiResult.merchantNormalizedSuggestion,
      branchAddress: rawGeminiResult.branchAddress,
      receiptNumber: rawGeminiResult.receiptNumber,
      transactionDateCandidate: rawGeminiResult.transactionDateCandidate,
      transactionTimeCandidate: rawGeminiResult.transactionTimeCandidate,
      dateInterpretationNote: rawGeminiResult.dateInterpretationNote,
      currency: rawGeminiResult.currency || 'PKR',
      paymentMethodCandidate: rawGeminiResult.paymentMethodCandidate,
      
      items: parsedItems,
      
      ...parsedTotals,
      
      computedLineTotal: reconciliation.computedLineTotal,
      computedExpectedTotal: reconciliation.computedExpectedTotal,
      discrepancy: reconciliation.discrepancy,
      reconciliationStatus: reconciliation.reconciliationStatus,
      
      rawOcrText: rawGeminiResult.rawOcrText,
      overallConfidence: rawGeminiResult.overallConfidence,
      ambiguousFields: rawGeminiResult.ambiguousFields,
      documentWarnings: docWarnings,
      warnings: [...docWarnings, ...reconciliation.warnings],
      
      extractionSchemaVersion: parseInt(EXTRACTION_SCHEMA_VERSION, 10),
      extractionModel: RECEIPT_EXTRACTION_MODEL,
      extractionModelActual: result.modelVersion || RECEIPT_EXTRACTION_MODEL,
      extractionDurationMs
    };

    logSafe(reqId, 'Successfully extracted receipt');
    return res.status(200).json(finalDto);

  } catch (error: any) {
    let safeError = error.message;
    if (safeError && typeof safeError === 'string') {
        safeError = safeError.replace(/AIza[a-zA-Z0-9-_]{35}/g, '[REDACTED_KEY]');
    } else {
        safeError = 'Unknown error occurred during extraction';
    }
    logSafe(reqId, 'Unexpected error', { safeError });
    return res.status(500).json({ error: 'Server error', code: 'INTERNAL_SERVER_ERROR' });
  } finally {
    clearTimeout(timeoutId);
    req.off('aborted', onAbort);
    if (req.body?.geminiKey) {
      delete req.body.geminiKey;
    }
    if (req.file) {
      req.file.buffer = Buffer.alloc(0);
    }
  }
});

export default router;
