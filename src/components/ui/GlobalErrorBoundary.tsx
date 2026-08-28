import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const MAX_DIAGNOSTIC_LENGTH = 800;

export function redactErrorDiagnostic(error: unknown): string {
  const name = error instanceof Error && ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name)
    ? error.name
    : 'Error';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const redacted = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[redacted-key]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(users|receipts|categories|aliases)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*/gi, '$1/[redacted-path]')
    .replace(/\b(uid|email|token|credential|password|apiKey|key)\s*[:=]\s*[^,;\s}]+/gi, '$1=[redacted]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[redacted-user-path]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '[redacted-user-path]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-opaque-value]');
  return `${name}: ${redacted}`.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

export function getErrorDiagnostic(error: unknown, production: boolean): string | null {
  return production ? null : redactErrorDiagnostic(error);
}

export function GlobalErrorFallback({ error, production }: { error: unknown; production: boolean }) {
  const diagnostic = getErrorDiagnostic(error, production);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 max-w-md w-full">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
        <p className="text-gray-500 mb-4 text-sm">An unexpected error occurred. Reload the application to continue.</p>
        {diagnostic && (
          <div className="bg-red-50 p-4 rounded-xl text-xs text-red-700 font-mono overflow-auto max-h-32 mb-6">
            {diagnostic}
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          className="w-full bg-blue-600 text-white font-medium py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors"
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}

export class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <GlobalErrorFallback error={this.state.error} production={import.meta.env.PROD} />;
  }
}
