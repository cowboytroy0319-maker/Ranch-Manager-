// Minimal ambient types for `bun:test` so `tsc --noEmit` can type-check the
// unit tests without pulling in @types/bun (the project pins `types: ["vite/client"]`).
// Runtime behavior comes from Bun's own test runner; this only satisfies the compiler.

declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
  export function expect<T>(actual: T): BunTestExpect<T>;
}

interface BunTestExpect<T> {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toThrow(message?: string | RegExp): void;
  toContain(item: unknown): void;
}