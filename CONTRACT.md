# Build contract (for parallel work; delete before release)

- Shared types: `src/types.ts`. Module signatures: the stubs in `src/core`, `src/io`, `src/net`,
  `src/worker/protocol.ts`. Implement the bodies; do not change exported signatures without
  saying so in your report.
- `src/core` is pure: no DOM, no fetch, no storage. It runs inside the Web Worker.
- Only `src/net/endpoints.ts` builds outbound URLs.
- Tests: Vitest, `tests/*.test.ts`, synthetic data only (`src/sample.ts`). No network in tests.
- UI test ids used by the Playwright smoke test:
  - `input[type=file][data-testid=file-input]`
  - `[data-testid=sample-btn]` loads the 40-job sample ("Try sample data")
  - `[data-testid=route-btn]` runs routing
  - `[data-testid=summary]` text contains `Routed: N` and `Not routed: M`
  - `[data-testid=export-csv]`, `[data-testid=export-xlsx]` trigger downloads
  - `[data-testid=simple-mode]` checkbox
  - `[data-testid=no-basemap]` option/checkbox
  - `[data-testid=busy]` progress overlay, `[data-testid=cancel-btn]`
- Do not run `git commit`. Do not add npm dependencies; ask in the report instead.
- `xlsx`: installed locally as npm 0.18.5 (--no-save, sandbox cannot reach cdn.sheetjs.com);
  package.json will pin the CDN 0.20.3 tarball. Use only `read`, `write`, `utils` APIs.
