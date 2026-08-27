# KharchaLens Verification & Test Report

## Passed

1. **Unit & Integration (Node.js)**
   - **Analytics & Money Engine**: `getDateRange`, dashboard summaries, percentage changes, handles zero-denominators, grouping, category compositions, item reports.
   - **Dates**: Handling of ambiguous dates, timezone boundary alignments for `Asia/Karachi`.
   - **Units**: Parse, normalize, and reconcile compatible units (e.g. `g` to `kg`, `ml` to `L`), correctly excludes estimated/imprecise units from aggregations.
   - **Export Services**: Validates CSV generation, Excel buffers (with minor internal deprecations ignored), and PDF structures.
   - **Backup Validator**: Generates structurally sound JSON dumps, verifies checksum algorithms, handles future schema migration gracefully, and reliably strips invalid or corrupt blob artifacts.
   - **Backend API Routes**: Gemini extraction proxy rejects unauthenticated connections, prevents oversized `multipart/form-data` uploads, handles secret redaction in traces, and simulates successful mocked gemini payloads.
   - **Account Deletion Routes**: Cascading batched delete operations correctly map exclusively to the requesting `uid` path and respect max batch sizes.

2. **Security & Privacy (Mocked Environments)**
   - **Cross-tenant Data Boundaries**: Verified via tests. User A receives 403 when reading/writing User B's receipts.
   - **Unauthenticated Blocks**: Missing token results in 401 across all cloud proxy endpoints.
   - **Image Persistence**: Mocked persistence wrappers (`localStorage`, `IndexedDB`, Service Worker interception) successfully flag any attempt to serialize Base64, raw blobs, or URL blobs to disk. Images strictly reside in volatile RAM (`ArrayBuffer`).
   - **Security Rules (`firestore.rules`)**: Verified with `@firebase/rules-unit-testing`. Rules explicitly reject arbitrary properties like `imageBase64`, `blob`, or `file`.

## Not Run (External E2E / Browser Automation)

*Due to constraints within the current AI Studio container environment (e.g., missing headless Chrome binaries and Java for Firebase Local Emulator), the following automated UI suites could not be executed synchronously. They require a local or CI environment.*

- **Full E2E Import Flow (Cypress / Playwright)**: Requires navigating the full browser context to emulate file upload -> object URL creation -> canvas cropping -> simulated network latency -> UI queue animations -> form confirmation.
  - *Setup*: Run locally using `npx playwright test`.
- **Firebase Local Emulator Suite**: Requires Java runtime. Designed to evaluate realistic write-delays, latency-compensation of the local cache, and offline tab-sync modes.
  - *Setup*: Run locally using `firebase emulators:start`.
- **Accessibility Render Tree (axe-core)**: Designed to dynamically parse ARIA live-regions (`aria-live="polite"`) and color contrast mappings on dynamic recharts SVGs.
  - *Setup*: Run locally using `npx cypress open --component`.

## Synthetic Data Scenarios Evaluated
- `standardSupermarket` (PKR parsing, exact matching quantities)
- `ambiguousDate` (DD/MM vs MM/DD)
- `weightedProduce` (Decimals, fractional kg, distinct parsing logic)
- `mixedLanguage` (Handling inline Roman Urdu / native Urdu strings)
- `totalMismatch` (Arithmetic reconciliation overrides)
- `corruptInput` (Fallback schemas and warning aggregations)
