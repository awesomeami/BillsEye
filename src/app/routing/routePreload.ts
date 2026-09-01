const routeModules = {
  '/': () => import('../../features/dashboard/DashboardScreen'),
  '/add': () => import('../../features/import/AddReceiptScreen'),
  '/inbox': () => import('../../features/inbox/InboxScreen'),
  '/receipts': () => import('../../features/receipts/ReceiptsListScreen'),
  '/reports': () => import('../../features/reports/ReportsScreen'),
  '/settings': () => import('../../features/settings/SettingsScreen'),
} as const;

export type PreloadableRoute = keyof typeof routeModules;

export function preloadRoute(path: string) {
  const normalizedPath = path.startsWith('/receipts/') ? '/receipts' : path;
  const load = routeModules[normalizedPath as PreloadableRoute];
  if (load) void load();
}

export const loadDashboardScreen = routeModules['/'];
export const loadAddReceiptScreen = routeModules['/add'];
export const loadInboxScreen = routeModules['/inbox'];
export const loadReceiptsListScreen = routeModules['/receipts'];
export const loadReportsScreen = routeModules['/reports'];
export const loadSettingsScreen = routeModules['/settings'];
