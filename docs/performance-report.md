# Performance report

Measured on 2026-08-28 from merged `main` commit `3529a05524e8efb27ce6da511aaa7123f6a02535`. The baseline was built from a clean `git archive` of that commit with the same production environment and Vite version as the optimized build. No Firestore document schema or denormalized field was added.

## Firestore receipt hydration

The baseline subscriptions called `getDocs(receipt/items)` for every receipt in every parent snapshot. The regression fixture contains 250 receipts with four item documents each and counts item queries and documents returned; it does not use wall-clock assertions.

| Snapshot | Baseline item queries / document reads | Optimized item queries / document reads |
| --- | ---: | ---: |
| Initial 250 receipts | 250 / 1,000 | 250 / 1,000 |
| Identical metadata snapshot | 250 / 1,000 | 0 / 0 |
| One receipt revision changes | 250 / 1,000 | 1 / 4 |
| One receipt is deleted, others unchanged | 249 / 996 | 0 / 0 |

The optimized hydrator is local to one confirmed or pending subscription. Its key includes receipt ID, `itemStorageVersion`, `revision`, and `updatedAt`. A newer snapshot generation is the only generation allowed to replace the cache; unsubscribe clears cached and in-flight state. The existing `SequencedAsyncSubscription` and `ActiveSessionGuard` remain in place, so stale hydration completion and cross-user callbacks are still rejected.

All application receipt writes already increment the parent revision and update its timestamp atomically with item writes. Direct item-only changes would not produce a parent receipt snapshot in either implementation, so the change does not weaken an existing notification path.

## Rendering and large-list behavior

| Fixture/behavior | Before | After |
| --- | ---: | ---: |
| Receipt rows mounted for a 240-receipt mobile library | 240 | 50 initially; 100 after one explicit “show more” action |
| Unchanged hydrated snapshot result | New array | Same array identity; React state can bail out |
| Search work during a controlled-input update | Full OCR/item scan in the urgent render | Search term passes through `useDeferredValue`; other filters remain immediate |

Receipt and receipt-item rows use `content-visibility: auto` with an intrinsic block-size estimate. Progressive pagination uses a normal button and keeps visible rows in document and keyboard order; it does not replace rows with inaccessible virtual placeholders. The Playwright fixture verifies the 390×844 journey through pagination, search, Enter-to-open, Escape-to-close/focus-restore, and horizontal-overflow detection.

## Production bundles

Values below are gzip KiB computed from `dist/.vite/manifest.json` by `scripts/check-performance-budgets.mjs`. A route value is the union of the entry, authenticated providers/shell where applicable, and the route's static dependency closure. Export actions are not included unless activated.

| Static dependency graph | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial/login route | 596.05 | 129.37 | -78.3% |
| Authenticated shell | 596.05 | 348.97 | -41.5% |
| Dashboard route | 606.39 | 472.33 | -22.1% |
| Receipts route | 605.51 | 358.76 | -40.7% |
| Monthly reports route | 604.28 | 471.08 | -22.0% |
| Settings route, before export activation | 619.11 | 370.61 | -40.1% |

The original main entry itself was 1,289.42 kB raw / 347.58 kB gzip in Vite's decimal units. The optimized entry is 469.55 kB raw / 132.48 kB gzip. The larger baseline initial graph also statically loaded the Recharts and jsPDF manual chunks; the optimized initial graph contains only the entry file.

Optional dependency chunks remain activation- or route-loaded:

- Excel export: 272.51 kB gzip
- PDF export/jsPDF: 138.81 kB gzip
- PDF import/PDF.js: 142.68 kB gzip, plus its worker asset
- html2canvas: 48.04 kB gzip, dynamically requested by PDF export when needed
- report chart implementation: route/view chunks, absent from the login entry

The split comes from separating Firebase Auth initialization from Firestore initialization, dynamically loading profile/Firestore work only for authenticated users, dynamically mounting authenticated AI-key/receipt-queue/PWA providers, lazily loading the protected receipt-library shell, and removing manual vendor chunks that created static cross-chunk edges. Export and PDF chunks are also excluded from PWA precaching so an update does not download them before feature activation.

## Regression budgets

`npm run build` now emits a Vite manifest and runs the bundle-budget script before the server bundle. It fails when:

- the initial static graph exceeds 150 KiB gzip;
- an authenticated shell/route exceeds its documented 10–17% headroom budget;
- Excel, PDF, jsPDF, or html2canvas enters the initial graph; or
- Excel export, PDF export/import, Reports, or Settings stops being a dynamic entry.

These are deterministic byte/dependency-graph and read-counter checks rather than machine-sensitive timing thresholds.

## Verification

- TypeScript typecheck: passed
- ESLint: passed with 0 errors and 62 existing warnings
- Unit suite: 201 passed, including four focused hydration-cache cases
- Firestore emulator suites: 15 passed
- Playwright desktop/mobile/keyboard journeys: 12 passed
- Production client build, bundle budgets, and server bundle: passed
