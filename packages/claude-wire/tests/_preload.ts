import * as realProcess from "@/process.js";

// Snapshots the real @/process.js module before any test file installs a
// mock.module override. mock.module is process-global with no auto-restore in
// bun, so once a sibling test file mocks @/process.js, the next file's static
// imports see the polluted version. Mocking files restore via this snapshot in
// afterAll() so test order (and CI vs local filesystem order) doesn't matter.
declare global {
  var __realProcessModule: typeof realProcess;
}
globalThis.__realProcessModule = realProcess;
