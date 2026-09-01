import React from 'react';
import { LoadingScreen, RouteLoadingState } from '../../components/ui/LoadingState';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { LoginScreen } from '../../features/auth/LoginScreen';
import {
  loadAddReceiptScreen,
  loadDashboardScreen,
  loadInboxScreen,
  loadReceiptsListScreen,
  loadReportsScreen,
  loadSettingsScreen,
} from './routePreload';
const ProtectedRoute = React.lazy(() => import('./ProtectedRoute').then(m => ({ default: m.ProtectedRoute })));
const AuthenticatedProviders = React.lazy(() => import('./AuthenticatedProviders').then(m => ({ default: m.AuthenticatedProviders })));
const DashboardScreen = React.lazy(() => loadDashboardScreen().then(m => ({ default: m.DashboardScreen })));
const AddReceiptScreen = React.lazy(() => loadAddReceiptScreen().then(m => ({ default: m.AddReceiptScreen })));
const InboxScreen = React.lazy(() => loadInboxScreen().then(m => ({ default: m.InboxScreen })));
const ReceiptsListScreen = React.lazy(() => loadReceiptsListScreen().then(m => ({ default: m.ReceiptsListScreen })));
const ReviewReceiptScreen = React.lazy(() => import('../../features/receipts/ReviewReceiptScreen').then(m => ({ default: m.ReviewReceiptScreen })));
const ReportsScreen = React.lazy(() => loadReportsScreen().then(m => ({ default: m.ReportsScreen })));
const SettingsScreen = React.lazy(() => loadSettingsScreen().then(m => ({ default: m.SettingsScreen })));
import { AuthProvider, useAuth } from '../../features/auth/AuthContext';

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginScreen />
  },
  {
    element: <React.Suspense fallback={<LoadingScreen />}><ProtectedRoute /></React.Suspense>,
    children: [
      { path: "/", element: <React.Suspense fallback={<RouteLoadingState />}><DashboardScreen /></React.Suspense> },
      { path: "/add", element: <React.Suspense fallback={<RouteLoadingState />}><AddReceiptScreen /></React.Suspense> },
      { path: "/inbox", element: <React.Suspense fallback={<RouteLoadingState />}><InboxScreen /></React.Suspense> },
      { path: "/receipts", element: <React.Suspense fallback={<RouteLoadingState />}><ReceiptsListScreen /></React.Suspense> },
      { path: "/receipts/:id/review", element: <React.Suspense fallback={<RouteLoadingState />}><ReviewReceiptScreen /></React.Suspense> },
      { path: "/reports", element: <React.Suspense fallback={<RouteLoadingState />}><ReportsScreen /></React.Suspense> },
      { path: "/settings", element: <React.Suspense fallback={<RouteLoadingState />}><SettingsScreen /></React.Suspense> }
    ]
  },
  {
    path: "*",
    element: <Navigate to="/" replace />
  }
]);

export function AppRouter() {
  return (
    <AuthProvider>
      <SessionProviders />
    </AuthProvider>
  );
}

function SessionProviders() {
  const { user, loading, sessionEpoch } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <RouterProvider router={router} />;

  return (
    <React.Suspense fallback={<LoadingScreen />}>
      <AuthenticatedProviders key={sessionEpoch}>
        <RouterProvider router={router} />
      </AuthenticatedProviders>
    </React.Suspense>
  );
}
