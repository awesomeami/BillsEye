import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { LoadingScreen } from '../../components/ui/LoadingState';
import { AppLayout } from '../../components/layout/AppLayout';
import { ReceiptsLibraryProvider } from '../../features/receipts/library/ReceiptsLibraryContext';

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // AppLayout already contains an <Outlet /> to render child routes
  return (
    <ReceiptsLibraryProvider>
      <AppLayout />
    </ReceiptsLibraryProvider>
  );
}
