import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import process from 'node:process';
import { log, error } from 'node:console';

const distDirectory = resolve(process.env.PERFORMANCE_DIST_DIRECTORY ?? 'dist');
const reportOnly = process.env.PERFORMANCE_REPORT_ONLY === 'true';
const manifest = JSON.parse(readFileSync(resolve(distDirectory, '.vite/manifest.json'), 'utf8'));

function manifestKey(sourceKey) {
  if (manifest[sourceKey]) return sourceKey;
  const expectedName = sourceKey.split('/').at(-1)?.replace(/\.[^.]+$/, '');
  const match = Object.entries(manifest).find(([, entryValue]) => (
    entryValue.src === sourceKey
    || (entryValue.isDynamicEntry && entryValue.name === expectedName)
  ));
  return match?.[0] ?? sourceKey;
}

function staticClosure(keys) {
  const closure = new Set();
  const visit = key => {
    if (!key || closure.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Manifest entry not found: ${key}`);
    closure.add(key);
    for (const imported of entry.imports ?? []) visit(imported);
  };
  keys.map(manifestKey).forEach(visit);
  return closure;
}

function gzipBytes(key) {
  const file = manifest[key]?.file;
  if (!file) return 0;
  return gzipSync(readFileSync(resolve(distDirectory, file))).byteLength;
}

function totalGzip(keys) {
  return [...keys].reduce((total, key) => total + gzipBytes(key), 0);
}

function union(...sets) {
  return new Set(sets.flatMap(set => [...set]));
}

function kib(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

const entry = staticClosure(['index.html']);
const providers = manifest['src/app/routing/AuthenticatedProviders.tsx']
  ? staticClosure(['src/app/routing/AuthenticatedProviders.tsx'])
  : new Set();
const protectedShell = manifest['src/app/routing/ProtectedRoute.tsx']
  ? staticClosure(['src/app/routing/ProtectedRoute.tsx'])
  : new Set();
const authenticatedShell = union(entry, providers, protectedShell);
const dashboard = union(authenticatedShell, staticClosure(['src/features/dashboard/DashboardScreen.tsx']));
const receipts = union(authenticatedShell, staticClosure(['src/features/receipts/ReceiptsListScreen.tsx']));
const monthlyReports = union(
  authenticatedShell,
  staticClosure(['src/features/reports/ReportsScreen.tsx']),
  staticClosure(['src/features/reports/views/MonthlyReportView.tsx']),
);
const settings = union(authenticatedShell, staticClosure(['src/features/settings/SettingsScreen.tsx']));

const metrics = {
  initialRouteGzipKiB: kib(totalGzip(entry)),
  authenticatedShellGzipKiB: kib(totalGzip(authenticatedShell)),
  dashboardRouteGzipKiB: kib(totalGzip(dashboard)),
  receiptsRouteGzipKiB: kib(totalGzip(receipts)),
  monthlyReportsRouteGzipKiB: kib(totalGzip(monthlyReports)),
  settingsRouteGzipKiB: kib(totalGzip(settings)),
};

const failures = [];
const INITIAL_ROUTE_BUDGET_KIB = 150;
if (!reportOnly && metrics.initialRouteGzipKiB > INITIAL_ROUTE_BUDGET_KIB) {
  failures.push(`initial route is ${metrics.initialRouteGzipKiB} KiB gzip (budget ${INITIAL_ROUTE_BUDGET_KIB} KiB)`);
}
const routeBudgets = {
  authenticatedShellGzipKiB: 400,
  dashboardRouteGzipKiB: 550,
  receiptsRouteGzipKiB: 420,
  monthlyReportsRouteGzipKiB: 550,
  settingsRouteGzipKiB: 430,
};
if (!reportOnly) {
  for (const [metric, budget] of Object.entries(routeBudgets)) {
    if (metrics[metric] > budget) failures.push(`${metric} is ${metrics[metric]} KiB gzip (budget ${budget} KiB)`);
  }
}

const initialFiles = [...entry].map(key => manifest[key].file).filter(Boolean);
const optionalDependencyPattern = /(excel|pdf(?:Processor)?|jspdf|html2canvas)/i;
const optionalInInitial = initialFiles.filter(file => optionalDependencyPattern.test(file));
if (!reportOnly && optionalInInitial.length > 0) {
  failures.push(`export/PDF dependencies entered the initial graph: ${optionalInInitial.join(', ')}`);
}

const requiredDynamicEntries = [
  'src/services/export/excel.ts',
  'src/utils/pdfProcessor.ts',
  'src/features/reports/ReportsScreen.tsx',
  'src/features/settings/SettingsScreen.tsx',
];
if (!reportOnly) {
  for (const key of requiredDynamicEntries) {
    if (!manifest[manifestKey(key)]?.isDynamicEntry) failures.push(`${key} is no longer a dynamic entry`);
  }
  if (!Object.values(manifest).some(entryValue => entryValue.isDynamicEntry && entryValue.name === 'pdf')) {
    failures.push('the PDF export module is no longer a dynamic entry');
  }
}

const output = {
  ...metrics,
  initialFiles,
  largestAssetKiB: Math.max(...Object.values(manifest).map(entryValue => {
    const file = entryValue.file;
    return file ? statSync(resolve(distDirectory, file)).size / 1024 : 0;
  })).toFixed(2),
};
log(JSON.stringify(output, null, 2));

if (failures.length > 0) {
  error(`Performance budget failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else if (!reportOnly) {
  log('Performance budgets passed.');
}
