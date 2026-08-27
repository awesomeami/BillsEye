import React from 'react';
import { LoadingScreen } from '../../components/ui/LoadingState';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { LoginScreen } from '../../features/auth/LoginScreen';
const DashboardScreen = React.lazy(() => import('../../features/dashboard/DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const AddReceiptScreen = React.lazy(() => import('../../features/import/AddReceiptScreen').then(m => ({ default: m.AddReceiptScreen })));
const InboxScreen = React.lazy(() => import('../../features/inbox/InboxScreen').then(m => ({ default: m.InboxScreen })));
const ReceiptsListScreen = React.lazy(() => import('../../features/receipts/ReceiptsListScreen').then(m => ({ default: m.ReceiptsListScreen })));
const ReviewReceiptScreen = React.lazy(() => import('../../features/receipts/ReviewReceiptScreen').then(m => ({ default: m.ReviewReceiptScreen })));
const ReportsScreen = React.lazy(() => import('../../features/reports/ReportsScreen').then(m => ({ default: m.ReportsScreen })));
const SettingsScreen = React.lazy(() => import('../../features/settings/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
import { AuthProvider } from '../../features/auth/AuthContext';
import { AiKeysProvider } from '../../features/settings/ai/AiKeysContext';
import { ReceiptQueueProvider } from '../../features/receipts/queue/ReceiptQueueContext';

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginScreen />
  },
  {
    element: <ProtectedRoute />,
    children: [
      { path: "/", element: <React.Suspense fallback={<LoadingScreen />}><DashboardScreen /></React.Suspense> },
      { path: "/add", element: <React.Suspense fallback={<LoadingScreen />}><AddReceiptScreen /></React.Suspense> },
      { path: "/inbox", element: <React.Suspense fallback={<LoadingScreen />}><InboxScreen /></React.Suspense> },
      { path: "/receipts", element: <React.Suspense fallback={<LoadingScreen />}><ReceiptsListScreen /></React.Suspense> },
      { path: "/receipts/:id/review", element: <React.Suspense fallback={<LoadingScreen />}><ReviewReceiptScreen /></React.Suspense> },
      { path: "/reports", element: <React.Suspense fallback={<LoadingScreen />}><ReportsScreen /></React.Suspense> },
      { path: "/settings", element: <React.Suspense fallback={<LoadingScreen />}><SettingsScreen /></React.Suspense> }
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
      <AiKeysProvider>
        <ReceiptQueueProvider>
          <RouterProvider router={router} />
        </ReceiptQueueProvider>
      </AiKeysProvider>
    </AuthProvider>
  );
}
