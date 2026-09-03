// Shared, dependency-free auth types — safe to import from both client
// (auth.ts) and server (authServer.ts) code.
export type AuthedUser = {
  userId: number;
  email: string;
  operationId: number;
  operationName: string;
  role: "owner" | "worker" | "viewer";
};

export type AuthResult =
  | { ok: true; email: string; operationId: number; operationName: string; role: string }
  | { ok: false; error: string };

export type RegisterInput = { email?: unknown; password?: unknown; ranchName?: unknown };
export type LoginInput = { email?: unknown; password?: unknown };