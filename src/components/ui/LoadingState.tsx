import React from 'react';
import { Loader2 } from 'lucide-react';

export function LoadingSpinner({ size = 24, className = '' }: { size?: number, className?: string }) {
  return (
    <Loader2 
      size={size} 
      className={`animate-spin text-blue-600 ${className}`} 
    />
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-3" role="status" aria-label="Loading application">
      <div className="rounded-2xl bg-blue-50 p-3">
        <LoadingSpinner size={32} />
      </div>
      <p className="text-sm font-medium text-gray-500">Loading KharchaLens…</p>
    </div>
  );
}

export function RouteLoadingState() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      <div className="border-b border-gray-200 pb-4">
        <div className="skeleton h-8 w-44 rounded-lg" />
        <div className="skeleton mt-2 h-4 w-64 max-w-[75%] rounded" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="skeleton h-44 rounded-2xl" />
        <div className="skeleton h-44 rounded-2xl" />
      </div>
      <div className="skeleton h-64 rounded-2xl" />
      <span className="sr-only">Loading page content</span>
    </div>
  );
}
