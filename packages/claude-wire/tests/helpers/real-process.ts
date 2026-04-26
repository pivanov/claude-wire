import * as realProcess from "@/process.js";

// Captured at first load -- before any test file installs a mock.module
// override. Any test file that mocks "@/process.js" must spread this as the
// base of its mock so the real safeKill / safeWrite / buildSpawnEnv etc. are
// preserved, since bun's mock.module is process-global with no auto-restore.
export const realProcessModule = { ...realProcess };
