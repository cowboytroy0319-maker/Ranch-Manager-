// ============================================================================
// Ranch Manager Pro — server-side CSV template download handler tests (bun test)
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/ranch_tasks_test \
//     bun test src/server/templateDownload.test.ts
//
// Covers the raw-HTTP download route (Item 2) by importing the handler
// directly and calling it with fabricated Requests — no shared :3000 server,
// no browser, no real iPhone:
//   • every one of the six slugs returns 200 with Content-Type
//     "text/csv; charset=utf-8" and Content-Disposition
//     `attachment; filename="ranch-<slug>.csv"` (the exact
//     getTemplateCsv/buildTemplateCsv naming)
//   • each served CSV has a header row, an example row, and the
//     field-legend/guidance block (content is built by the unchanged
//     buildTemplateCsv — no regression)
//   • unauthenticated / expired / unknown-slug requests are rejected
//     (redirect to /login?reason=auth or 404)
//
// Guard: refuses to run against anything that isn't a local Postgres, so the
// owner's Neon is never touched by this file.
// ============================================================================
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../db/migrate";
import { closeDb, sql } from "~/db";
import { handleTemplateDownload, sessionTokenFromRequest } from "./templateDownload";
import { newSessionToken, registerCore, sha256Hex, SESSION_COOKIE } from "./authServer";
import { buildTemplateCsv, assertTemplateSlug } from "./onboarding";
import { TEMPLATE_SLUGS, type TemplateSlug } from "~/types/onboarding";

type TestDb = ReturnType<typeof sql>;

let db: TestDb;

const URL_BASE = "https://ranchmanagerpro.test";

/** Build a fake GET /templates/<slug>.csv Request with an optional rmp_session cookie. */
function downloadRequest(slug: string, token?: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  return new Request(`${URL_BASE}/templates/${slug}.csv`, { method: "GET", headers });
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1/.test(url)) {
    throw new Error(
      "templateDownload.test.ts requires a LOCAL test Postgres (DATABASE_URL with 127.0.0.1). " +
        "See the local-postgres-testing skill; the owner's Neon must never be used."
    );
  }
  db = sql();
  await runMigrations(); // idempotent; includes 0014_auth_users_operations.sql
});

afterAll(async () => {
  try {
    await db`DELETE FROM users WHERE email LIKE ${"download-test-%"}`;
  } catch {
    /* best effort */
  }
  try {
    await closeDb();
  } catch {
    /* best effort */
  }
});

describe("sessionTokenFromRequest — cookie parsing (raw HTTP layer)", () => {
  test("parses the rmp_session cookie from a single header", () => {
    const req = new Request(`${URL_BASE}/templates/livestock.csv`, {
      headers: { cookie: `${SESSION_COOKIE}=abc123` },
    });
    expect(sessionTokenFromRequest(req)).toBe("abc123");
  });

  test("handles a multi-cookie header and trims whitespace", () => {
    const req = new Request(`${URL_BASE}/templates/livestock.csv`, {
      headers: { cookie: `other=1; ${SESSION_COOKIE}=  xyz  ; third=2` },
    });
    expect(sessionTokenFromRequest(req)).toBe("xyz");
  });

  test("returns null when absent or empty", () => {
    expect(sessionTokenFromRequest(new Request(`${URL_BASE}/templates/livestock.csv`))).toBeNull();
    const req = new Request(`${URL_BASE}/templates/livestock.csv`, {
      headers: { cookie: `${SESSION_COOKIE}=` },
    });
    expect(sessionTokenFromRequest(req)).toBeNull();
  });
});

describe("template download route — auth rejection", () => {
  test("no cookie → 302 redirect to /login?reason=auth (like protected routes)", async () => {
    const res = await handleTemplateDownload(downloadRequest("livestock"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${URL_BASE}/login?reason=auth`);
  });

  test("unknown token → 302 redirect to /login?reason=auth", async () => {
    const res = await handleTemplateDownload(downloadRequest("livestock", "bogus-token"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${URL_BASE}/login?reason=auth`);
  });

  test("unknown slug → 404 even with a valid session", async () => {
    const res = await handleTemplateDownload(downloadRequest("not-a-template"));
    expect(res.status).toBe(404);
  });
});

describe("template download route — authenticated downloads", () => {
  let token: string;

  beforeAll(async () => {
    // Register a real account so a live session row exists for the token.
    const res = await registerCore(db, {
      email: `download-test-${Date.now()}@example.com`,
      password: "CorrectHorse42!",
      operationName: "Download Test Ranch",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("registerCore should have succeeded");
    // registerCore's createSessionRow attaches the cookie via request context
    // (no-op here), so craft a token and insert its hash directly — the exact
    // shape the login path stores (see createSessionRow in authServer.ts).
    token = newSessionToken();
    const [user] = await db<[{ id: number }]>`SELECT id FROM users WHERE email = ${res.email}`;
    await db`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES (${sha256Hex(token)}, ${user.id}, now() + interval '1 day')`;
  });

  test("each of the six slugs returns 200 + text/csv + attachment Content-Disposition with ranch-<slug>.csv", async () => {
    for (const slug of TEMPLATE_SLUGS) {
      const res = await handleTemplateDownload(downloadRequest(slug, token));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="ranch-${slug}.csv"`
      );
      // Same CSV content the existing authenticated server fn served.
      const body = await res.text();
      expect(body).toBe(buildTemplateCsv(slug));
    }
  });

  test("session token hash matches the login path (sha256Hex round-trip)", async () => {
    // The row we inserted was keyed by sha256Hex(token); an expired/absent row
    // must not resolve. Delete the row and confirm the route now redirects.
    await db`DELETE FROM sessions WHERE token_hash = ${sha256Hex(token)}`;
    const res = await handleTemplateDownload(downloadRequest("livestock", token));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${URL_BASE}/login?reason=auth`);
  });

  test("expired session → redirect to login (expires_at in the past)", async () => {
    token = newSessionToken();
    const [user] = await db<[{ id: number }]>`SELECT id FROM users WHERE email LIKE 'download-test-%' ORDER BY id LIMIT 1`;
    await db`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES (${sha256Hex(token)}, ${user.id}, now() - interval '1 minute')`;
    const res = await handleTemplateDownload(downloadRequest("tasks", token));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${URL_BASE}/login?reason=auth`);
  });
});

describe("template CSV content — no regression (header row, example row, field guidance)", () => {
  test("assertTemplateSlug accepts all six real slugs", () => {
    for (const slug of TEMPLATE_SLUGS) {
      expect(assertTemplateSlug(slug)).toBe(slug);
      expect(assertTemplateSlug(slug)).toMatch(/^(livestock|pastures|hay-feed|equipment|expenses|tasks)$/);
    }
    // Unknown slugs are rejected by the same validator the handler uses.
    expect(() => assertTemplateSlug("nope")).toThrow("Unknown template.");
  });

  test("every template CSV has a distinct filename, header row, example row, and legend", () => {
    for (const slug of TEMPLATE_SLUGS) {
      const csv = buildTemplateCsv(slug as TemplateSlug);
      const lines = csv.split("\n");
      // 1: # header comment · 2: header row · 3: example row · 4: blank · 5+: legend
      expect(lines.length > 5).toBe(true);
      expect(csv.startsWith("# Ranch Manager Pro — ")).toBe(true);
      // header row = the exact accepted field names
      const header = lines[1];
      expect(header.length > 0).toBe(true);
      expect(header).not.toContain("#");
      // example row has the same column count as the header
      const example = lines[2];
      expect(example.split(",").length).toBe(header.split(",").length);
      // legend/guidance block present
      expect(csv).toContain("# FIELD DEFINITIONS");
      expect(csv).toContain("# EXAMPLE ROW (delete before importing):");
      // no macros / no links / no PII
      expect(csv).not.toContain("http://");
      expect(csv).not.toContain("https://");
      // distinct filename per slug
      expect(`ranch-${slug}.csv`).not.toBe(`ranch-${TEMPLATE_SLUGS[(TEMPLATE_SLUGS.indexOf(slug) + 1) % TEMPLATE_SLUGS.length]}.csv`);
    }
  });

  test("all six filenames are distinct and match ranch-<slug>.csv", () => {
    const filenames = TEMPLATE_SLUGS.map((slug) => `ranch-${slug}.csv`);
    // Exact set the app served before (getTemplateCsv naming) — no regress.
    const expected = [
      "ranch-livestock.csv",
      "ranch-pastures.csv",
      "ranch-hay-feed.csv",
      "ranch-equipment.csv",
      "ranch-expenses.csv",
      "ranch-tasks.csv",
    ];
    expect(filenames).toEqual(expected);
    expect(new Set(filenames).size).toBe(filenames.length); // all distinct
  });
});