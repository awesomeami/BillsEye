import { useEffect, useRef } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { QueueItem, QueueAction } from './queueReducer';
import { preprocessImage, createSha256Hash } from '../../../utils/imageUtils';
import { receiptRepository } from '../../../services/firebase/db';
import { ExtractionClient } from '../../../services/ai/ExtractionClient';
import { ImageSessionStore } from '../../../utils/imageSessionStore';

interface ProcessorDeps {
  state: QueueItem[];
  dispatch: React.Dispatch<QueueAction>;
  user: any;
  executor: any;
  getDecryptedKey: (index: number) => Promise<string | null>;
  rotationManager: any;
}

export const useQueueProcessor = ({
  state,
  dispatch,
  user,
  executor,
  getDecryptedKey,
  rotationManager
}: ProcessorDeps) => {
  const isProcessingRef = useRef(false);

  useEffect(() => {
    // Determine if we need to wake up the processor
    const hasWork = state.some(item => item.status === 'queued');
    if (!hasWork || isProcessingRef.current || !user || !executor) {
      return;
    }

    const processNext = async () => {
      isProcessingRef.current = true;
      try {
        while (true) {
          const nextItem = state.find(i => i.status === 'queued');
          if (!nextItem) break;
          
          if (!navigator.onLine) {
            dispatch({ type: 'UPDATE_ITEM', id: nextItem.id, updates: { status: 'failed-permanent', error: 'Internet is required to process a receipt.' } });
            break;
          }

          const { id, abortController } = nextItem;
          
          try {
            // 1. Preprocessing
            dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'preprocessing' } });
            
            let fileToProcess = nextItem.file;
            let mimeType = nextItem.mimeType;
            let objectUrl = nextItem.objectUrl;

            if (nextItem.sourcePdf && nextItem.pageNumber) {
              const { renderPdfPageToImage } = await import('../../../utils/pdfProcessor');
              const renderedBlob = await renderPdfPageToImage(nextItem.sourcePdf, nextItem.pageNumber);
              if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
              fileToProcess = renderedBlob;
              mimeType = 'image/jpeg';
              objectUrl = URL.createObjectURL(renderedBlob);
              dispatch({ type: 'UPDATE_ITEM', id, updates: { file: renderedBlob, mimeType, objectUrl } });
            }

            const { blob: processedBlob, mimeType: processedMime } = await preprocessImage(fileToProcess, abortController.signal);
            
            // 2. Hash & Duplicate Check
            dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'duplicate-check', file: processedBlob, mimeType: processedMime } });
            const sha256 = await createSha256Hash(processedBlob);
            dispatch({ type: 'UPDATE_ITEM', id, updates: { sha256 } });

            if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            const existing = await receiptRepository.findByHash(user.uid, sha256);
            if (existing.length > 0) {
              dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'duplicate', receiptId: existing[0].id } });
              continue;
            }

            // 3. Extraction
            dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'extracting' } });
            
            const result = await executor.execute(
              'ExtractReceipt',
              async (key: string, signal: AbortSignal) => {
                // Link executor's signal with our item's abort signal
                const compositeSignal = anySignal([signal, abortController.signal]);
                const fileToUpload = new File([processedBlob], nextItem.originalName, { type: processedMime });
                return await ExtractionClient.extractReceipt(key, fileToUpload, compositeSignal);
              },
              getDecryptedKey
            );

            if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');

            if (!result.isReceipt) {
              dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'failed-permanent', error: result.documentWarnings?.join(', ') || 'Image does not appear to be a receipt.' } });
              continue;
            }

            const newReceiptId = crypto.randomUUID();
            const receiptDoc = {
              id: newReceiptId,
              schemaVersion: 2, revision: 1,
              status: 'pendingReview' as const,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              confirmedAt: null,
              sourceFileName: nextItem.originalName,
              sourceMimeType: processedMime,
              sourceSha256: sha256,
              merchantRaw: result.merchantRaw,
              merchantNormalized: result.merchantNormalizedSuggestion,
              branchAddress: result.branchAddress,
              receiptNumber: result.receiptNumber,
              transactionDate: result.transactionDateCandidate,
              transactionTime: result.transactionTimeCandidate,
              dateAmbiguous: Boolean(result.dateInterpretationNote),
              currency: result.currency || 'PKR',
              paymentMethod: result.paymentMethodCandidate,
              items: (result.items || []).map((it: any) => ({
                id: crypto.randomUUID(),
                rawLineText: it.rawLineText,
                name: it.name,
                brand: it.brand,
                quantity: it.quantity,
                unit: it.unit,
                unitPrice: it.unitPrice,
                discount: it.discount,
                lineTotal: it.lineTotal,
                category: it.categorySuggestion,
                confidence: it.confidence,
                userEdited: false,
                warnings: it.warnings || []
              })),
              printedSubtotal: result.printedSubtotal,
              printedDiscount: result.printedDiscount,
              printedTax: result.printedTax,
              printedFees: result.printedFees,
              printedRounding: result.printedRounding,
              printedGrandTotal: result.printedGrandTotal,
              computedLineTotal: result.computedLineTotal,
              computedExpectedTotal: result.computedExpectedTotal,
              discrepancy: result.discrepancy,
              reconciliationStatus: result.reconciliationStatus || 'unknown',
              rawOcrText: result.rawOcrText,
              overallConfidence: result.overallConfidence,
              warnings: result.warnings || [],
              ambiguousFields: result.ambiguousFields || [],
              extractionModel: result.extractionModel,
              extractionModelActual: result.extractionModelActual,
              extractionSchemaVersion: result.extractionSchemaVersion,
              extractionDurationMs: result.extractionDurationMs,
              wasEditedByUser: false
            };

            await receiptRepository.createReceipt(user.uid, receiptDoc);
            
            // Store transient blob for review
            ImageSessionStore.set(newReceiptId, processedBlob);
            
            dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'needs-review', extractionResult: result, receiptId: newReceiptId } });
            
          } catch (err: any) {
            if (err.name === 'AbortError') {
               // Status is already handled by CANCEL action, or we can just ignore
               continue;
            }
            
            const isRateLimit = err.message?.includes('cooldown') || err.status === 429;
            const is5xx = err.status >= 500 && err.status < 600;
            const isNetwork = err.message?.toLowerCase().includes('fetch') || err.message?.toLowerCase().includes('network');
            
            if (isRateLimit || is5xx || isNetwork) {
               dispatch({ 
                 type: 'UPDATE_ITEM', id, 
                 updates: { 
                   status: 'retry-wait', 
                   error: err.message, 
                   retryAfter: rotationManager?.getEarliestRetryTime() || Date.now() + 30000 
                 }
               });
               break; // Stop processing further items until retry wait is over
            } else {
               dispatch({ type: 'UPDATE_ITEM', id, updates: { status: 'failed-permanent', error: err.message } });
            }
          }
        }
      } finally {
        isProcessingRef.current = false;
      }
    };
    
    processNext();
    
  }, [state, dispatch, user, executor, getDecryptedKey, rotationManager]);
};

function anySignal(signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
