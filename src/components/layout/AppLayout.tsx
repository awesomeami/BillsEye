import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';
import { NetworkStatus } from '../ui/NetworkStatus';

export function AppLayout() {
  return (
    <div className="relative flex min-h-dvh min-w-0 flex-col bg-transparent md:flex-row">
      <NetworkStatus />
      <Navigation />
      <main className="relative min-w-0 flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:pt-5 md:px-6 md:py-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
