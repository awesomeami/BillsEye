import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import {
  ExtractionControlService,
  FirestoreExtractionControlStore,
  InMemoryExtractionControlStore,
  type ExtractionAdmission,
} from './extractionControls.js';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getReceiptExtractionModel, EXTRACTION_SCHEMA_VERSION } from './geminiConfig.js';
import { ExtractionResultSchema, RawGeminiReceiptV2 } from '../domain/schema.js';
import { parseMajorToMinor } from '../domain/money.js';
import { calculateReceiptTotals } from '../domain/reconciliation.js';

export const RECEIPT_EXTRACTION_INSTRUCTION = `Act as a high-precision, layout-aware receipt transcription engine for Pakistani retail receipts, including English, Urdu, and Roman Urdu.
Extract only visible information. Never invent unreadable or absent values. Return null plus a warning for missing or unreadable fields; never substitute zero.

Read the receipt spatially before extracting:
- Associate each value with its column header by horizontal position, even when headers are abbreviated, punctuated, merged, wrapped, or repeated in an unlabeled summary row.
- Keep wrapped or multi-line descriptions with their item. Do not turn subtotal/summary rows, tender, change, loyalty, tax-registration, or receipt metadata into sale items.
- Treat repeated values beneath the item table as receipt totals, not duplicate items.

Handle unconventional money columns carefully:
- Recognize tax labels including Sales Tax, S.Tax, ST, GST, VAT, FED, Tax Amt, and compound headers such as S.Tax@%.
- A compound tax header may contain two adjacent values: the monetary tax amount followed by the percentage rate. For example, under S.Tax@%, "581 17" means taxAmount 581 and taxRatePercent 17; never swap the amount and rate.
- For each item, normally use its printed Amount/Total as lineTotal. If a separate tax amount is printed on that row and the final Total includes it, use the visible pre-tax, post-discount amount as lineTotal so receipt-level printedTax is not added twice. If no defensible pre-tax amount is visible, return null and warn instead of calculating one.
- Extract an explicit receipt-level or column-summary tax amount as printedTax. Also populate every visible per-item taxAmount and taxRatePercent; the server, not the model, may total a complete tax column when no aggregate is printed.
- Distinguish discount amounts from percentages, and preserve refunds, negative adjustments, parentheses, and minus signs.
- Recognize service charges, delivery charges, levies, tips, rounding, and other explicit adjustments under their correct totals fields.
- Cash/tendered/card-paid amounts and change due are payment metadata, not the printedGrandTotal. A balance due or net payable is a grand total only when the receipt layout identifies it that way.

Return monetary values as decimal strings in major currency units without currency symbols or thousands separators. A visibly printed zero is 0; an absent value is null.
Use arithmetic only to check column interpretation and detect likely swaps or double counting. Do not alter visible values merely to force agreement. Preserve conflicts and add a warning.
Preserve raw text separately from normalized suggestions. Recognize PKR, Rs/Rs., comma separators, decimals, weights, quantities, and patterns such as "2 x 150".
Use YYYY-MM-DD only when defensible; flag ambiguous day/month ordering.
Category suggestions are limited to the following or null: Groceries, Meat, Fruit & Vegetables, Household, Medicine, Eating Out, Miscellaneous.
Confidence reflects legibility and extraction certainty, not arithmetic agreement.
Return only the requested structured JSON result.`.trim();

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
          systemInstruction: RECEIPT_EXTRACTION_INSTRUCTION,
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
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
                    unitPrice: { type: 'string', nullable: true, description: 'Visible per-unit price as a decimal string in major currency units' },
                    discount: { type: 'string', nullable: true, description: 'Visible per-line discount amount, not percentage, as a decimal string in major units' },
                    taxAmount: { type: 'string', nullable: true, description: 'Visible monetary tax for this row as a decimal string in major units; never the tax percentage' },
                    taxRatePercent: { type: 'string', nullable: true, description: 'Visible tax percentage for this row without the percent sign; never the monetary tax amount' },
                    lineTotal: { type: 'string', nullable: true, description: 'Amount contributing to the receipt subtotal before separately extracted receipt tax/fees; see system instructions for tax-inclusive Total columns' },
                    categorySuggestion: { type: 'string', nullable: true, description: 'Groceries, Meat, Fruit & Vegetables, Household, Medicine, Eating Out, Miscellaneous' },
                    confidence: { type: 'number' },
                    warnings: { type: 'array', items: { type: 'string' } }
                  }
                }
              },
              printedSubtotal: { type: 'string', nullable: true, description: 'Explicit or column-aligned pre-tax subtotal, including an unlabeled table-summary value, as a decimal string in major units' },
              printedDiscount: { type: 'string', nullable: true, description: 'Receipt-level discount amount, not percentage, as a decimal string in major units' },
              printedTax: { type: 'string', nullable: true, description: 'Receipt-level or complete column-summary monetary tax amount, never a tax rate or registration number, as a decimal string in major units' },
              printedFees: { type: 'string', nullable: true, description: 'Explicit receipt-level service, delivery, levy, tip, or other fee total as a decimal string in major units' },
              printedRounding: { type: 'string', nullable: true, description: 'Explicit signed rounding adjustment as a decimal string in major units' },
              printedGrandTotal: { type: 'string', nullable: true, description: 'Final payable/net total as a decimal string in major units; never cash tendered or change due' },
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
    const parsedItemTaxes: Array<number | null> = [];
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

      parsedItemTaxes.push(safeParseItemAmount(item.taxAmount));

      return {
        // The browser persists receipt items using ReceiptItemSchema, which
        // requires a stable item ID. Gemini should never be asked to invent
        // one, so the server owns this contract boundary.
        id: randomUUID(),
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
        warnings: itemWarnings.slice(0, 10),
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

    const printedSubtotal = safeParseTotalAmount(rawGeminiResult.printedSubtotal);
    const explicitPrintedTax = safeParseTotalAmount(rawGeminiResult.printedTax);
    const completeItemTaxTotal = parsedItemTaxes.length > 0 && parsedItemTaxes.every((tax): tax is number => tax != null)
      ? parsedItemTaxes.reduce((sum, tax) => sum + tax, 0)
      : null;
    const derivedPrintedTax = explicitPrintedTax == null && printedSubtotal != null
      ? completeItemTaxTotal
      : null;

    if (derivedPrintedTax != null) {
      docWarnings.push('Tax total calculated from the complete visible item-tax column.');
    }

    const parsedTotals = {
      printedSubtotal,
      printedDiscount: safeParseTotalAmount(rawGeminiResult.printedDiscount),
      printedTax: explicitPrintedTax ?? derivedPrintedTax,
      printedFees: safeParseTotalAmount(rawGeminiResult.printedFees),
      printedRounding: safeParseTotalAmount(rawGeminiResult.printedRounding),
      printedGrandTotal: safeParseTotalAmount(rawGeminiResult.printedGrandTotal)
    };
    
    const reconciliation = calculateReceiptTotals(parsedItems, parsedTotals);
    const extractionDurationMs = Date.now() - startTime;
    
    const finalDto = {
      isReceipt: true,
      merchantRaw: rawGeminiResult.merchantRaw,
      merchantNormalized: rawGeminiResult.merchantNormalizedSuggestion,
      branchAddress: rawGeminiResult.branchAddress,
      receiptNumber: rawGeminiResult.receiptNumber,
      transactionDate: rawGeminiResult.transactionDateCandidate,
      transactionTime: rawGeminiResult.transactionTimeCandidate,
      dateAmbiguous: /\b(?:ambiguous|uncertain|unclear)\b/i.test(rawGeminiResult.dateInterpretationNote ?? ''),
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
      documentWarnings: docWarnings.slice(0, 20),
      warnings: [...docWarnings, ...reconciliation.warnings].slice(0, 20),
      
      extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
      extractionModel,
      extractionModelActual: result.modelVersion || extractionModel,
      extractionDurationMs
    };

    const validatedDto = ExtractionResultSchema.safeParse(finalDto);
    if (!validatedDto.success) {
      logSafe(reqId, 'Normalized extraction failed response-contract validation');
      return res.status(422).json({
        error: 'Gemini response could not be normalized safely',
        code: 'UNPROCESSABLE_ENTITY',
      });
    }

    logSafe(reqId, 'Successfully extracted receipt');
    return res.status(200).json(validatedDto.data);

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
