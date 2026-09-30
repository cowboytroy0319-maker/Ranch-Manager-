// Minimal ambient types for `bun:test` so `tsc --noEmit` can type-check the
// unit tests without pulling in @types/bun (the project pins `types: ["vite/client"]`).
// Runtime behavior comes from Bun's own test runner; this only satisfies the compiler.

// The optional trailing `timeout` parameter is part of Bun's real test API and IS
// honoured at runtime (verified on bun 1.4.2: a hook that overruns the 5s default fails
// the whole file with "a beforeEach/afterEach hook timed out for this test" unless it is
// given a larger timeout). It is declared here because the migration/preflight/schema-check
// suites pass it; without it, call sites like `beforeAll(fn, HOOK_TIMEOUT_MS)` are TS2554
// and the CI typecheck guard (site/tsc-baseline.txt diff) goes red.
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  export function expect<T>(actual: T): BunTestExpect<T>;
  // Lifecycle hooks used by the auth integration tests (src/server/auth.test.ts).
  // The trailing timeout is what the DB-backed migration suites rely on.
  export function beforeAll(fn: () => void | Promise<void>, timeout?: number): void;
  export function afterAll(fn: () => void | Promise<void>, timeout?: number): void;
  export function beforeEach(fn: () => void | Promise<void>, timeout?: number): void;
  export function afterEach(fn: () => void | Promise<void>, timeout?: number): void;
  // Global default timeout for tests/hooks that do not pass their own.
  export function setDefaultTimeout(ms: number): void;
}

interface BunTestExpect<T> {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toThrow(message?: string | RegExp): void;
  toContain(item: unknown): void;
  toMatch(regex: RegExp): void;
  // Matchers used by the auth integration tests (negation + presence).
  not: BunTestExpect<T>;
  toBeDefined(): void;
}