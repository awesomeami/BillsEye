/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppRouter } from './app/routing/Router';
import { ToastProvider } from './components/ui/Toast';
import { GlobalErrorBoundary } from './components/ui/GlobalErrorBoundary';

export default function App() {
  return (
    <GlobalErrorBoundary>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </GlobalErrorBoundary>
  );
}


