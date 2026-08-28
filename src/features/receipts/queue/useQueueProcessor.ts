import { useEffect, useReducer, useRef } from 'react';
import { QueueItem, QueueAction } from './queueReducer';
import {
  processQueueAttempt,
  QueueAttemptServices,
  QueueExecutor,
  QueueRotationManager,
  SequentialQueueRunner,
} from './queueProcessor';
import { preprocessImage, createSha256Hash } from '../../../utils/imageUtils';
import { receiptRepository } from '../../../services/firebase/db';
import { ExtractionClient } from '../../../services/ai/ExtractionClient';
import { ImageSessionStore } from '../../../utils/imageSessionStore';

interface ProcessorDeps {
  state: QueueItem[];
  dispatch: React.Dispatch<QueueAction>;
  user: { uid: string } | null;
  executor: QueueExecutor | null;
  getDecryptedKey: (index: number) => Promise<string | null>;
  rotationManager: QueueRotationManager | null;
}

const productionQueueAttemptServices: QueueAttemptServices = {
  isOnline: () => navigator.onLine,
  preprocessImage,
  createSha256Hash,
  findByHash: (userId, sha256) => receiptRepository.findByHash(userId, sha256),
  extractReceipt: (key, file, signal) => ExtractionClient.extractReceipt(key, file, signal),
  createReceipt: (userId, receipt) => receiptRepository.createReceipt(userId, receipt),
  storeImage: (userId, receiptId, image) => ImageSessionStore.setForUser(userId, receiptId, image),
  renderPdfPage: async (file, pageNumber) => {
    const { renderPdfPageToImage } = await import('../../../utils/pdfProcessor');
    return renderPdfPageToImage(file, pageNumber);
  },
  createReceiptId: () => crypto.randomUUID(),
  now: () => new Date().toISOString()
};

export const useQueueProcessor = ({
  state,
  dispatch,
  user,
  executor,
  getDecryptedKey,
  rotationManager
}: ProcessorDeps) => {
  const latestRef = useRef({ state, dispatch, user, executor, getDecryptedKey, rotationManager });
  const activeUserIdRef = useRef<string | null>(user?.uid ?? null);
  const sessionVersionRef = useRef(0);
  const [, requestNext] = useReducer((value: number) => value + 1, 0);

  const userId = user?.uid ?? null;
  if (activeUserIdRef.current !== userId) {
    activeUserIdRef.current = userId;
    sessionVersionRef.current += 1;
  }
  latestRef.current = { state, dispatch, user, executor, getDecryptedKey, rotationManager };

  const runnerRef = useRef<SequentialQueueRunner | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = new SequentialQueueRunner({
      getNextItem: () => latestRef.current.state.find(item => item.status === 'queued'),
      claimItem: item => {
        latestRef.current.dispatch({ type: 'START_ATTEMPT', id: item.id, timestamp: Date.now() });
      },
      processItem: async item => {
        const current = latestRef.current;
        if (!current.user || !current.executor) return 'stopped';
        const attemptUserId = current.user.uid;
        const attemptSessionVersion = sessionVersionRef.current;
        return processQueueAttempt({
          item,
          userId: attemptUserId,
          dispatch: current.dispatch,
          executor: current.executor,
          getDecryptedKey: current.getDecryptedKey,
          rotationManager: current.rotationManager,
          isSessionActive: () =>
            activeUserIdRef.current === attemptUserId && sessionVersionRef.current === attemptSessionVersion,
          services: productionQueueAttemptServices
        });
      },
      canContinue: () => Boolean(latestRef.current.user && latestRef.current.executor),
      requestNext
    });
  }

  useEffect(() => {
    runnerRef.current?.wake();
  }, [state, userId, executor, getDecryptedKey, rotationManager]);

  useEffect(() => () => {
    activeUserIdRef.current = null;
    sessionVersionRef.current += 1;
    latestRef.current = { ...latestRef.current, state: [], user: null, executor: null };
  }, []);
};
