import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Migration-heavy suites (full-stack replay per test) overrun the 5s
    // default when the whole workspace runs in parallel; 15s removes the
    // load-induced flakes without masking real hangs.
    testTimeout: 15_000,
    // Many concurrent test files slow every test down ~10x on many-core dev
    // machines, which trips the per-chapter search worker's 3s business
    // timeout and the migration budgets; cap file parallelism at half the
    // cores (CI runners have few cores and are unaffected).
    maxWorkers: '50%',
  },
})
