// ============================================================================
// Ranch Manager Pro — password-reset public surface (client-safe)
// ----------------------------------------------------------------------------
// The only password-reset module client code may import. No server-only
// imports here: handlers lazy-dynamic-import ./passwordResetServer (plus
// ./authServer for hashing) so node:crypto and ~/db never enter the client
// bundle — same pattern as ./auth.ts.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return { email: d.email, ip: d.ip, origin: d.origin };
  })
  .handler(async ({ data }): Promise<{ ok: true; message: string }> => {
    const [{ isDatabaseConfigured, sql }, resetSrv] = await Promise.all([
      import("~/db"),
      import("./passwordResetServer"),
    ]);
    if (!isDatabaseConfigured()) {
      // No DB → still neutral (never reveal configuration state details).
      return { ok: true, message: resetSrv.RESET_NEUTRAL_MESSAGE };
    }
    const res = await resetSrv.requestPasswordResetCore(sql(), {
      email: data.email,
      ip: data.ip,
      origin: data.origin,
    });
    // testOnly (non-production test mode) is deliberately NOT forwarded.
    return { ok: true, message: res.message };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return { token: d.token, email: d.email, password: d.password, confirm: d.confirm };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string; error?: string }> => {
    const [{ isDatabaseConfigured, sql }, resetSrv, authSrv] = await Promise.all([
      import("~/db"),
      import("./passwordResetServer"),
      import("./authServer"),
    ]);
    if (!isDatabaseConfigured()) {
      return { ok: false, error: resetSrv.RESET_INVALID_TOKEN_MESSAGE };
    }
    const res = await resetSrv.resetPasswordCore(
      sql(),
      { token: data.token, email: data.email, password: data.password, confirm: data.confirm },
      (plain: string) => authSrv.hashPassword(plain)
    );
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, message: res.message };
  });
