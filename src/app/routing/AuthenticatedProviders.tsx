import React from 'react';
import { AiKeysProvider } from '../../features/settings/ai/AiKeysContext';
import { ReceiptQueueProvider } from '../../features/receipts/queue/ReceiptQueueContext';
import { PwaUpdateProvider } from '../../features/pwa/PwaUpdateProvider';

export function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  return (
    <AiKeysProvider>
      <ReceiptQueueProvider>
        <PwaUpdateProvider>{children}</PwaUpdateProvider>
      </ReceiptQueueProvider>
    </AiKeysProvider>
  );
}
