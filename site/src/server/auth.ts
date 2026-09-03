// ============================================================================
// Ranch Manager Pro — Auth public surface (client-safe)
// ----------------------------------------------------------------------------
// THIS module is the only auth file client code may import. It must contain
// NO server-only imports: nothing from "@tanstack/react-start/server", no
// "~/db", no node:crypto, no postgres. Server-only machinery lives in
// ./authServer.ts, which the createServerFn handlers below lazy-load via
// dynamic import — the TanStack client transform replaces handlers with RPC
// stubs, so the dynamic imports never enter the client bundle.
//
// Sessions: the server stores the SHA-256 of a random 32-byte token in the
// `sessions` table (token_hash PK — the raw token is never persisted). The
// client holds the raw token in a cookie named `rmp_session`, HttpOnly,
// SameSite=Lax, 30-day expiry.
//
// Password hashing is node:crypto scrypt with a random per-user salt, stored
// as `scrypt:N:r:p:salthex:hashhex` (implemented in ./authServer).
//
// registerCore/loginCore create a NEW operation per account (owner
// membership) — a registered user never touches the seeded "Default
// Operation" or its demo data (see §"Demo data divorce" in auth.test.ts).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import type {
  AuthedUser,
  AuthResult,
  LoginInput,
  RegisterInput,
} from "./authTypes";

// ---------------------------------------------------------------------------
// Pure, dependency-light helpers (client-safe — no node builtins, no DB)
// ---------------------------------------------------------------------------
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export function isValidEmail(raw: unknown): boolean {
  const email = normalizeEmail(raw);
  // Deliberately simple: non-empty, single @, no spaces, sensible length.
  if (email.length < 3 || email.length > 254) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return true;
}

const parseRegisterInput = (raw: unknown): RegisterInput => {
  const d = (raw ?? {}) as Record<string, unknown>;
  return { email: d.email, password: d.password, ranchName: d.ranchName };
};

const parseLoginInput = (raw: unknown): LoginInput => {
  const d = (raw ?? {}) as Record<string, unknown>;
  return { email: d.email, password: d.password };
};

// ---------------------------------------------------------------------------
// Public server functions (client-callable). Handlers lazy-load ./authServer
// so the client bundle stays free of ./authServer / ~/db / node:crypto.
// ---------------------------------------------------------------------------

export const register = createServerFn({ method: "POST" })
  .validator(parseRegisterInput)
  .handler(async ({ data }): Promise<AuthResult> => {
    const [{ isDatabaseConfigured, sql }, authSrv] = await Promise.all([
      import("~/db"),
      import("./authServer"),
    ]);
    if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured." };
    return authSrv.registerCore(sql(), {
      email: data.email,
      password: data.password,
      operationName: data.ranchName,
    });
  });

export const login = createServerFn({ method: "POST" })
  .validator(parseLoginInput)
  .handler(async ({ data }): Promise<AuthResult> => {
    const [{ isDatabaseConfigured, sql }, authSrv] = await Promise.all([
      import("~/db"),
      import("./authServer"),
    ]);
    if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured." };
    return authSrv.loginCore(sql(), { email: data.email, password: data.password });
  });

export const logout = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: true }> => {
  try {
    const [{ isDatabaseConfigured, sql }, authSrv] = await Promise.all([
      import("~/db"),
      import("./authServer"),
    ]);
    if (isDatabaseConfigured()) {
      const token = authSrv.readSessionToken();
      if (token) {
        try {
          await authSrv.deleteSessionByToken(sql(), token);
        } catch {
          // the cookie still gets cleared below
        }
      }
    }
  } catch {
    // no DB / no server context — just clear the cookie below
  }
  try {
    const authSrv = await import("./authServer");
    authSrv.clearSessionCookie();
  } catch {
    /* ignore */
  }
  return { ok: true };
});

export const getSession = createServerFn().handler(async (): Promise<{
  authed: boolean;
  email?: string;
  operationId?: number;
  operationName?: string;
  role?: string;
}> => {
  try {
    const [{ isDatabaseConfigured, sql }, authSrv] = await Promise.all([
      import("~/db"),
      import("./authServer"),
    ]);
    if (!isDatabaseConfigured()) return { authed: false };
    const auth = await authSrv.resolveAuth(sql());
    if (!auth) return { authed: false };
    return {
      authed: true,
      email: auth.email,
      operationId: auth.operationId,
      operationName: auth.operationName,
      role: auth.role,
    };
  } catch {
    return { authed: false };
  }
});

export type { AuthedUser, AuthResult, LoginInput, RegisterInput };