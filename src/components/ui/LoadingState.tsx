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
    <div className="min-h-[400px] flex items-center justify-center">
      <LoadingSpinner size={40} />
    </div>
  );
}
