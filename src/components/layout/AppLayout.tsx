import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';
import { NetworkStatus } from '../ui/NetworkStatus';

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50 md:flex-row flex-col relative">
      <NetworkStatus />
      <Navigation />
      <main className="flex-1 w-full max-w-5xl mx-auto md:p-8 p-4 pb-24 md:pb-8 relative">
        <Outlet />
      </main>
    </div>
  );
}
