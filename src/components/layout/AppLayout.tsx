import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';
import { NetworkStatus } from '../ui/NetworkStatus';

export function AppLayout() {
  return (
    <div className="app-shell relative flex min-h-dvh min-w-0 flex-col bg-transparent md:flex-row">
      <NetworkStatus />
      <Navigation />
      <main className="app-main relative min-w-0 flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-7 md:px-8 md:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
