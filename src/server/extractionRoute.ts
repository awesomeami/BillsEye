import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { getFirebaseAdmin } from './firebaseAdmin';
import { GoogleGenAI } from '@google/genai';
import { RECEIPT_EXTRACTION_MODEL, EXTRACTION_SCHEMA_VERSION } from './geminiConfig';
import { ExtractionResultSchema, MAX_RECEIPT_ITEMS, RawGeminiReceiptV2 } from '../domain/schema';
import { parseMajorToMinor } from '../domain/money';
import { reconcileReceipt } from '../domain/reconciliation';

const router = Router();

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + (64 * 1024);
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const EXTRACTION_RATE_LIMIT = 12;
const EXTRACTION_RATE_WINDOW_MS = 60_000;
const OVERSIZED_DRAIN_TIMEOUT_MS = 1_000;

type AuthenticatedRequest = Request & { authenticatedUid?: string };
type RateLimitBucket = { count: number; resetAt: number };
const extractionRateBuckets = new Map<string, RateLimitBucket>();

// Store only in memory. These limits constrain multipart parser memory before
// data can reach Gemini, while authentication and rate limits run first.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    // Multer emits the parts-limit event as it encounters the next boundary,
    // so allow the two accepted parts plus its terminating boundary.
    parts: 3,
    fieldNameSize: 64,
    fieldSize: 512,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      callback(new Error('UNSUPPORTED_IMAGE_TYPE'));
      return;
    }
    callback(null, true);
  },
});

const generateRequestId = () => Math.random().toString(36).substring(2, 10);

const redactGeminiKeys = (text: string) => text.replace(/AIza[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
const SENSITIVE_LOG_FIELDS = new Set(['key', 'geminikey', 'apikey', 'token', 'authorization']);

const redactLogValue = (value: unknown): unknown => {
  if (typeof value === 'string') return redactGeminiKeys(value);
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([field, nestedValue]) => [
      field,
      SENSITIVE_LOG_FIELDS.has(field.toLowerCase()) ? '[REDACTED]' : redactLogValue(nestedValue)
    ]));
  }
  return value;
};

const logSafe = (reqId: string, message: string, meta: Record<string, unknown> = {}) => {
  const safeMeta = redactLogValue(meta) as Record<string, unknown>;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), reqId, message, ...safeMeta }));
};

function isStructurallyValidPng(bytes: Buffer): boolean {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !pngSignature.every((byte, index) => bytes[index] === byte)) return false;

  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const dataLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const nextOffset = dataStart + dataLength + 4; // data plus CRC
    if (nextOffset > bytes.length) return false;

    if (!sawHeader) {
      if (chunkType !== 'IHDR' || dataLength !== 13) return false;
      if (bytes.readUInt32BE(dataStart) === 0 || bytes.readUInt32BE(dataStart + 4) === 0) return false;
      sawHeader = true;
    } else if (chunkType === 'IDAT') {
      if (dataLength === 0) return false;
      sawImageData = true;
    } else if (chunkType === 'IEND') {
      return dataLength === 0 && sawImageData && nextOffset === bytes.length;
    }
    offset = nextOffset;
  }
  return false;
}

function isStructurallyValidJpeg(bytes: Buffer): boolean {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  let sawFrame = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) return false;
    if (marker === 0xda) {
      return sawFrame && bytes.length >= offset + 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 8 || bytes.readUInt16BE(offset + 3) === 0 || bytes.readUInt16BE(offset + 5) === 0) return false;
      sawFrame = true;
    }
    offset += segmentLength;
  }
  return false;
}

function isStructurallyValidWebp(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) return false;

  let offset = 12;
  let sawImageChunk = false;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('ascii', offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const nextOffset = offset + 8 + chunkLength + (chunkLength % 2);
    if (nextOffset > bytes.length) return false;
    if (chunkType === 'VP8 ' || chunkType === 'VP8L' || chunkType === 'VP8X') sawImageChunk = true;
    offset = nextOffset;
  }
  return sawImageChunk && offset === bytes.length;
}

function isStructurallyValidImage(file: Express.Multer.File): boolean {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg') {
    return isStructurallyValidJpeg(bytes);
  }
  if (file.mimetype === 'image/png') {
    return isStructurallyValidPng(bytes);
  }
  return isStructurallyValidWebp(bytes);
}

function rejectUnauthorized(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
}

async function verifyFirebaseToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    logSafe(generateRequestId(), 'Missing or invalid Authorization header');
    return rejectUnauthorized(res);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length > 4096) {
    logSafe(generateRequestId(), 'Missing or invalid Authorization header');
    return rejectUnauthorized(res);
  }

  try {
    const decodedToken = await getFirebaseAdmin().auth.verifyIdToken(token);
    req.authenticatedUid = decodedToken.uid;
    return next();
  } catch {
    logSafe(generateRequestId(), 'Invalid or expired Firebase ID token');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Invalid or expired Firebase ID token', code: 'UNAUTHORIZED' });
  }
}

function enforceExtractionRateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const uid = req.authenticatedUid;
  if (!uid) return rejectUnauthorized(res);

  const now = Date.now();
  for (const [key, bucket] of extractionRateBuckets) {
    if (bucket.resetAt <= now) extractionRateBuckets.delete(key);
  }
  const existing = extractionRateBuckets.get(uid);
  if (existing && existing.count >= EXTRACTION_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: 'Too many extraction requests. Please try again shortly.', code: 'RATE_LIMITED' });
  }

  if (existing) {
    existing.count += 1;
  } else {
    if (extractionRateBuckets.size >= 1000) {
      const oldestKey = extractionRateBuckets.keys().next().value;
      if (oldestKey) extractionRateBuckets.delete(oldestKey);
    }
    extractionRateBuckets.set(uid, { count: 1, resetAt: now + EXTRACTION_RATE_WINDOW_MS });
  }
  return next();
}

function rejectOversizedMultipartRequest(req: Request, res: Response, next: NextFunction) {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    res.setHeader('Cache-Control', 'no-store');
    // Discard (do not buffer) the authenticated request before responding so
    // ordinary oversized uploads receive a reliable 413. Bound the drain so a
    // peer cannot hold a worker by declaring a large body and trickling it.
    let settled = false;
    const respond = () => {
      if (settled) return;
      settled = true;
      clearTimeout(drainTimeout);
      if (!res.headersSent) {
        res.status(413).json({ error: 'File too large', code: 'PAYLOAD_TOO_LARGE' });
      }
    };
    const drainTimeout = setTimeout(() => {
      respond();
      req.destroy();
    }, OVERSIZED_DRAIN_TIMEOUT_MS);
    req.once('end', respond);
    req.once('error', respond);
    req.once('aborted', () => {
      settled = true;
      clearTimeout(drainTimeout);
    });
    req.resume();
    return;
  }
  return next();
}

function parseReceiptUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('receiptImage')(req, res, (err) => {
    if (err) {
      if (req.file) req.file.buffer.fill(0);
      res.setHeader('Cache-Control', 'no-store');
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large', code: 'PAYLOAD_TOO_LARGE' });
      }
      if (err instanceof Error && err.message === 'UNSUPPORTED_IMAGE_TYPE') {
        return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.', code: 'BAD_REQUEST' });
      }
      return res.status(400).json({ error: 'Upload error', code: 'BAD_REQUEST' });
    }
    return next();
  });
}

export function resetExtractionRateLimitForTests() {
  extractionRateBuckets.clear();
}

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

router.post('/extract', verifyFirebaseToken, enforceExtractionRateLimit, rejectOversizedMultipartRequest, parseReceiptUpload, async (req, res) => {
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
    // Authentication, rate limiting, and multipart limits run before this handler.
    // Validate the parsed image before forwarding it to Gemini.
    const file = req.file;
    if (!file) {
      logSafe(reqId, 'Missing receipt image');
      return res.status(400).json({ error: 'Missing receipt image', code: 'BAD_REQUEST' });
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      logSafe(reqId, 'Unsupported image format');
      return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.', code: 'BAD_REQUEST' });
    }
    if (!isStructurallyValidImage(file)) {
      logSafe(reqId, 'Image structure does not match declared MIME type');
      return res.status(400).json({ error: 'Invalid image file', code: 'BAD_REQUEST' });
    }

    // Extract the key from the bounded multipart form field.
    const geminiKey = req.body?.geminiKey as string;
    if (!geminiKey) {
      logSafe(reqId, 'Missing Gemini API key in request body');
      return res.status(401).json({ error: 'Missing Gemini API key in request body', code: 'MISSING_GEMINI_KEY' });
    }

    // Initialize SDK
    logSafe(reqId, 'Initializing GoogleGenAI');
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    // Instruction & Schema
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

    // Call Gemini
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
                maxItems: MAX_RECEIPT_ITEMS,
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
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error('Unknown Gemini request error');
      const errorWithResponse = error as Error & { response?: { headers?: Headers }; status?: number };
      const errorMsg = error.message;
      logSafe(reqId, 'Gemini request failed', { errorMsg: redactGeminiKeys(errorMsg) });
      
      let retryAfterSeconds: number | null = null;
      if (errorWithResponse.response?.headers) {
        retryAfterSeconds = extractRetryAfter(errorWithResponse.response.headers);
      }

      if (errorMsg.includes('abort') || ac.signal.aborted) {
        return res.status(504).json({ error: 'Request timeout or aborted', code: 'TIMEOUT' });
      }
      
      if (errorWithResponse.status === 429 || errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('resource has been exhausted')) {
        return res.status(429).json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED', retryAfter: retryAfterSeconds });
      }

      if (errorWithResponse.status === 401 || errorWithResponse.status === 403 || errorMsg.toLowerCase().includes('api key not valid') || errorMsg.toLowerCase().includes('api key expired')) {
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
    } catch {
        logSafe(reqId, 'Failed to parse Gemini response as JSON');
        return res.status(502).json({ error: 'Failed to parse Gemini response as JSON', code: 'BAD_GATEWAY' });
    }
    
    // Validate raw with Zod
    let rawGeminiResult;
    try {
        rawGeminiResult = RawGeminiReceiptV2.parse(parsedData);
    } catch {
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

    const docWarnings = [...rawGeminiResult.documentWarnings];
    const rawItems = rawGeminiResult.items.slice(0, MAX_RECEIPT_ITEMS);
    if (rawGeminiResult.items.length > MAX_RECEIPT_ITEMS) {
      docWarnings.push(
        `Only the first ${MAX_RECEIPT_ITEMS} line items were retained because KharchaLens supports up to ${MAX_RECEIPT_ITEMS} items per receipt. Review the receipt and edit the retained items as needed.`
      );
    }

    // Convert decimal strings to minor units deterministically with graceful error degradation.
    // The result below uses the persisted ReceiptItem field names and minor-unit amounts.
    const parsedItems = rawItems.map(item => {
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
        id: crypto.randomUUID(),
        rawLineText: item.rawLineText,
        name: item.name,
        brand: item.brand,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: safeParseItemAmount(item.unitPrice),
        discount: safeParseItemAmount(item.discount),
        lineTotal: safeParseItemAmount(item.lineTotal),
        category: item.categorySuggestion,
        confidence: item.confidence,
        userEdited: false,
        warnings: itemWarnings,
      };
    });

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
    
    const finalDto = ExtractionResultSchema.parse({
      isReceipt: true,
      merchantRaw: rawGeminiResult.merchantRaw,
      merchantNormalized: rawGeminiResult.merchantNormalizedSuggestion,
      branchAddress: rawGeminiResult.branchAddress,
      receiptNumber: rawGeminiResult.receiptNumber,
      transactionDate: rawGeminiResult.transactionDateCandidate,
      transactionTime: rawGeminiResult.transactionTimeCandidate,
      dateAmbiguous: Boolean(rawGeminiResult.dateInterpretationNote),
      currency: rawGeminiResult.currency || 'PKR',
      paymentMethod: rawGeminiResult.paymentMethodCandidate,
      
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
      
      extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      extractionModel: RECEIPT_EXTRACTION_MODEL,
      extractionModelActual: result.modelVersion || RECEIPT_EXTRACTION_MODEL,
      extractionDurationMs
    });

    logSafe(reqId, 'Successfully extracted receipt');
    return res.status(200).json(finalDto);

  } catch (error: unknown) {
    let safeError = error instanceof Error ? error.message : '';
    if (safeError && typeof safeError === 'string') {
        safeError = redactGeminiKeys(safeError);
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
