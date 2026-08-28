import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { getFirebaseAdmin } from './firebaseAdmin';
import {
  ExtractionControlService,
  FirestoreExtractionControlStore,
  InMemoryExtractionControlStore,
  type ExtractionAdmission,
} from './extractionControls';
import { GoogleGenAI } from '@google/genai';
import { getReceiptExtractionModel, EXTRACTION_SCHEMA_VERSION } from './geminiConfig';
import { RawGeminiReceiptV2 } from '../domain/schema';
import { parseMajorToMinor } from '../domain/money';
import { calculateReceiptTotals } from '../domain/reconciliation';

// Store only in memory, limit to ~4MB to be safe for Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1,
    fields: 1,
    parts: 3,
    fieldNameSize: 64,
    fieldSize: 512,
  }
});

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const generateRequestId = () => Math.random().toString(36).substring(2, 10);

type SafeLogMeta = {
  providerStatus?: number;
};

type ProviderError = {
  message?: unknown;
  response?: { headers?: Headers };
  status?: unknown;
};

const logSafe = (reqId: string, message: string, meta: SafeLogMeta = {}) => {
  const providerStatus = typeof meta.providerStatus === 'number' && Number.isInteger(meta.providerStatus)
    ? meta.providerStatus
    : undefined;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), reqId, message, providerStatus }));
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

export type ExtractionRouteOptions = {
  localControls?: ExtractionControlService;
  sharedControls?: ExtractionControlService;
  multipartParser?: (req: Request, res: Response, next: NextFunction) => void;
};

type ExtractionLease = {
  uid: string;
  leaseId: string;
};

const setNoStoreHeaders = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

const sendAdmissionDenied = (res: Response, admission: Exclude<ExtractionAdmission, { allowed: true }>): void => {
  res.setHeader('Retry-After', admission.retryAfterSeconds.toString());
  res.status(429).json({
    error: admission.reason === 'rate_limited'
      ? 'Too many extraction requests. Please try again shortly.'
      : 'An extraction request is already in progress.',
    code: admission.reason === 'rate_limited' ? 'RATE_LIMITED' : 'EXTRACTION_IN_PROGRESS',
    retryAfter: admission.retryAfterSeconds,
  });
};

const sendUploadError = (res: Response, error: unknown): void => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  res.status(400).json({ error: 'Upload error', code: 'BAD_REQUEST' });
};

const sendUnauthorizedBeforeMultipart = (req: Request, res: Response, message: string): void => {
  // Drain without parsing/buffering so the client receives a clean 401 instead
  // of a connection reset while an oversized multipart body is still sending.
  req.resume();
  res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
};

export const createExtractionRoute = (options: ExtractionRouteOptions = {}) => {
  const router = Router();
  const localControls = options.localControls ?? new ExtractionControlService(new InMemoryExtractionControlStore());
  let sharedControls = options.sharedControls;

  const getSharedControls = (): ExtractionControlService => {
    if (!sharedControls) {
      sharedControls = new ExtractionControlService(
        new FirestoreExtractionControlStore(getFirebaseAdmin().db),
      );
    }
    return sharedControls;
  };

  const releaseLease = async (lease: ExtractionLease | undefined): Promise<void> => {
    if (!lease) return;
    try {
      await Promise.all([
        localControls.release(lease.uid, lease.leaseId),
        getSharedControls().release(lease.uid, lease.leaseId),
      ]);
    } catch {
      // The persisted lease still expires after the documented short safety window.
      logSafe(generateRequestId(), 'Failed to release extraction lease');
    }
  };

  const authenticateAndAcquire = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    setNoStoreHeaders(res);

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      logSafe(generateRequestId(), 'Missing or invalid Authorization header');
      sendUnauthorizedBeforeMultipart(req, res, 'Missing or invalid Authorization header');
      return;
    }

    const token = authHeader.slice('Bearer '.length);
    let admin;
    try {
      admin = getFirebaseAdmin();
    } catch {
      logSafe(generateRequestId(), 'Firebase Admin configuration unavailable');
      res.status(503).json({ error: 'Extraction service is temporarily unavailable', code: 'CONFIGURATION_UNAVAILABLE' });
      return;
    }

    let uid: string;
    try {
      const decodedToken = await admin.auth.verifyIdToken(token);
      uid = decodedToken.uid;
    } catch {
      logSafe(generateRequestId(), 'Invalid or expired Firebase ID token');
      sendUnauthorizedBeforeMultipart(req, res, 'Invalid or expired Firebase ID token');
      return;
    }

    const leaseId = randomUUID();
    const localAdmission = await localControls.acquire(uid, leaseId);
    if (localAdmission.allowed === false) {
      sendAdmissionDenied(res, localAdmission);
      return;
    }

    try {
      const sharedAdmission = await getSharedControls().acquire(uid, leaseId);
      if (sharedAdmission.allowed === false) {
        await localControls.release(uid, leaseId);
        sendAdmissionDenied(res, sharedAdmission);
        return;
      }
    } catch {
      await localControls.release(uid, leaseId);
      logSafe(generateRequestId(), 'Extraction admission control unavailable');
      res.status(503).json({ error: 'Extraction service is temporarily unavailable', code: 'EXTRACTION_CONTROL_UNAVAILABLE' });
      return;
    }

    res.locals.extractionLease = { uid, leaseId } satisfies ExtractionLease;
    req.once('aborted', () => {
      const lease = res.locals.extractionLease as ExtractionLease | undefined;
      res.locals.extractionLease = undefined;
      void releaseLease(lease);
    });
    next();
  };

  const parseMultipart = (req: Request, res: Response, next: NextFunction): void => {
    upload.single('receiptImage')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      void releaseLease(res.locals.extractionLease as ExtractionLease | undefined).finally(() => {
        res.locals.extractionLease = undefined;
        sendUploadError(res, error);
      });
    });
  };

  const multipartParser = options.multipartParser ?? parseMultipart;

router.post('/extract', authenticateAndAcquire, multipartParser, async (req, res) => {
  const reqId = generateRequestId();
  const startTime = Date.now();
  
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
    // Authentication and the shared admission lease are established before
    // multipart parsing, so only verified callers can consume upload memory.
    // 1. Validate Image
    const file = req.file;
    if (!file) {
      logSafe(reqId, 'Missing receipt image');
      return res.status(400).json({ error: 'Missing receipt image', code: 'BAD_REQUEST' });
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      logSafe(reqId, 'Unsupported image format');
      return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.', code: 'BAD_REQUEST' });
    }

    // 2. Extract Gemini Key from Request Body (multipart form field)
    const geminiKey = req.body?.geminiKey as string;
    if (!geminiKey) {
      logSafe(reqId, 'Missing Gemini API key in request body');
      return res.status(401).json({ error: 'Missing Gemini API key in request body', code: 'MISSING_GEMINI_KEY' });
    }

    // 3. Initialize SDK
    logSafe(reqId, 'Initializing GoogleGenAI');
    const extractionModel = getReceiptExtractionModel();
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    // 4. Instruction & Schema
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

    // 5. Call Gemini
    logSafe(reqId, 'Calling Gemini generateContent');
    let result;
    try {
      result = await ai.models.generateContent({
        model: extractionModel,
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
    } catch (error: unknown) {
      const providerError = error as ProviderError;
      const errorMsg = typeof providerError.message === 'string' ? providerError.message : '';
      logSafe(reqId, 'Gemini request failed', {
        providerStatus: typeof providerError.status === 'number' ? providerError.status : undefined,
      });
      
      let retryAfterSeconds: number | null = null;
      if (providerError.response?.headers) {
        retryAfterSeconds = extractRetryAfter(providerError.response.headers);
      }

      if (errorMsg.includes('abort') || ac.signal.aborted) {
        return res.status(504).json({ error: 'Request timeout or aborted', code: 'TIMEOUT' });
      }
      
      if (providerError.status === 429 || errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.toLowerCase().includes('resource has been exhausted')) {
        return res.status(429).json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED', retryAfter: retryAfterSeconds });
      }

      if (providerError.status === 401 || providerError.status === 403 || errorMsg.toLowerCase().includes('api key not valid') || errorMsg.toLowerCase().includes('api key expired')) {
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
    
    const reconciliation = calculateReceiptTotals(parsedItems, parsedTotals);
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
      
      extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      extractionModel,
      extractionModelActual: result.modelVersion || extractionModel,
      extractionDurationMs
    };

    logSafe(reqId, 'Successfully extracted receipt');
    return res.status(200).json(finalDto);

  } catch {
    logSafe(reqId, 'Unexpected error');
    return res.status(500).json({ error: 'Server error', code: 'INTERNAL_SERVER_ERROR' });
  } finally {
    clearTimeout(timeoutId);
    req.off('aborted', onAbort);
    await releaseLease(res.locals.extractionLease as ExtractionLease | undefined);
    res.locals.extractionLease = undefined;
    if (req.body?.geminiKey) {
      delete req.body.geminiKey;
    }
    if (req.file) {
      req.file.buffer = Buffer.alloc(0);
    }
  }
});

return router;
};

export default createExtractionRoute();
