// THE PLANTED-SECRET SUITE.
//
// A redaction function whose tests never feed it a secret is vacuous -- this
// repo shipped exactly that defect and only mutation caught it. So every
// assertion here starts from PLANTED_SECRETS below: real-shaped credentials of
// every kind this app actually handles, each asserted absent from the output by
// its own literal text, not by "the output looks redacted".
//
// This file covers the PURE half (the scrubber as a function). The end-to-end
// half -- the same planted values driven through the recorder and the rendered
// markdown -- is activityLogDocument.test.js's "planted secret" describe.

import { describe, it, expect } from "vitest";
import { redactSecretText, redactSecretsDeep, redactUrlForLog, REDACTED } from "./activityRedaction.js";
import { PLANTED_SECRETS, secretLiteral as literalOf } from "../../test/helpers/plantedSecrets.js";

describe("the fixture itself is a real fixture", () => {
  it("plants a distinct, non-trivial secret for every shape this app handles", () => {
    // A fixture of empty strings would make every assertion below pass
    // vacuously -- the exact failure this suite exists to prevent.
    expect(PLANTED_SECRETS.length).toBeGreaterThanOrEqual(8);
    for (const secret of PLANTED_SECRETS) {
      expect(secret.literal.length, `${secret.id} is too short to be a real secret`).toBeGreaterThan(20);
      expect(secret.where.length, `${secret.id} does not say where it comes from`).toBeGreaterThan(10);
    }
    expect(new Set(PLANTED_SECRETS.map((s) => s.literal)).size).toBe(PLANTED_SECRETS.length);
  });
});

describe("redactSecretText: a secret in a VALUE, under an innocent key", () => {
  // The case a key-name-only scrubber (lib/copilot/sessionLog.js's
  // CREDENTIAL_KEYS) cannot see: a provider error string, a stack trace or a
  // URL that happens to carry the credential in its text.
  for (const secret of PLANTED_SECRETS) {
    it(`removes ${secret.id} from free text (${secret.where})`, () => {
      const carrier = `Request failed: ${secret.literal} was rejected by the provider`;
      const out = redactSecretText(carrier);
      expect(out, `${secret.id} survived into the output`).not.toContain(secret.literal);
      expect(out).toContain(REDACTED);
      // The surrounding diagnostic text is the whole reason to keep the field.
      expect(out).toContain("was rejected by the provider");
    });
  }

  it("leaves ordinary text completely alone", () => {
    const plain = "POST /api/tailor 200 in 812 ms (engine=gemini, rows=14)";
    expect(redactSecretText(plain)).toBe(plain);
  });

  it("never throws on a non-string", () => {
    expect(() => redactSecretText(null)).not.toThrow();
    expect(() => redactSecretText(undefined)).not.toThrow();
    expect(() => redactSecretText(42)).not.toThrow();
  });
});

describe("redactSecretsDeep: a secret under a credential-shaped KEY", () => {
  it("redacts by key name even when the value looks harmless", () => {
    const out = redactSecretsDeep({ apiKey: "abc", authorization: "x", password: "p", cookie: "c" });
    expect(out.apiKey).toBe(REDACTED);
    expect(out.authorization).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
  });

  it("does not redact a field merely because its name contains a substring", () => {
    // "keywords" contains "key"; "sessionStartedAt" contains "session". Over-
    // redacting the log's own diagnostics is how a log stops being useful.
    const out = redactSecretsDeep({ keywords: "react, node", sessionStartedAt: 1700000000000, monkey: "banana" });
    expect(out.keywords).toBe("react, node");
    expect(out.sessionStartedAt).toBe(1700000000000);
    expect(out.monkey).toBe("banana");
  });

  it("reaches a secret nested inside arrays and objects", () => {
    const jwt = literalOf("supabase-anon-jwt");
    const out = redactSecretsDeep({ headers: [{ name: "authorization", value: `Bearer ${jwt}` }] });
    expect(JSON.stringify(out)).not.toContain(jwt);
  });

  it("scrubs every planted secret out of a deeply nested payload", () => {
    const payload = {
      request: { url: "/api/tailor", headers: { Authorization: literalOf("bearer-header") } },
      env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: literalOf("supabase-anon-jwt"), GEMINI_API_KEY: literalOf("gemini-api-key") },
      form: { email: "a@b.com", password: literalOf("password") },
      notes: [`cookie: ${literalOf("session-cookie")}`, `key ${literalOf("openai-style-key")} rejected`],
      auth: { refresh_token: literalOf("refresh-token"), service: literalOf("supabase-service-role") },
    };
    const rendered = JSON.stringify(redactSecretsDeep(payload));
    for (const secret of PLANTED_SECRETS) {
      expect(rendered, `${secret.id} survived redactSecretsDeep`).not.toContain(secret.literal);
    }
    // …and the non-secret context survived, so this is redaction, not deletion.
    expect(rendered).toContain("/api/tailor");
    expect(rendered).toContain("a@b.com");
  });

  it("survives a cycle, a throwing getter and a function without losing the object", () => {
    const cyclic = { name: "root" };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "boom", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });
    cyclic.fn = () => {};
    let out;
    expect(() => {
      out = redactSecretsDeep(cyclic);
    }).not.toThrow();
    expect(out.name).toBe("root");
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe("redactUrlForLog: a URL is a disclosure surface", () => {
  it("keeps the path and drops every query VALUE", () => {
    const out = redactUrlForLog("https://app.example.com/api/tailor?token=abc123&page=2");
    expect(out).toContain("/api/tailor");
    expect(out).not.toContain("abc123");
    // The key NAMES survive: "which parameters were sent" is diagnostic, the
    // values are not.
    expect(out).toContain("token");
    expect(out).toContain("page");
  });

  it("drops the fragment entirely", () => {
    // Supabase's implicit auth flow returns the access token in the URL HASH,
    // which never reaches the server and is the single most likely place for a
    // live credential to be sitting in `location.href`.
    const jwt = literalOf("supabase-anon-jwt");
    const out = redactUrlForLog(`https://app.example.com/auth/callback#access_token=${jwt}&type=bearer`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("access_token=");
    expect(out).toContain("/auth/callback");
  });

  it("handles a relative URL, the shape every in-app fetch actually uses", () => {
    expect(redactUrlForLog("/api/drive/status")).toBe("/api/drive/status");
  });

  it("never throws and never returns a raw unparseable URL unscrubbed", () => {
    const jwt = literalOf("supabase-anon-jwt");
    const out = redactUrlForLog(`::: not a url ::: ${jwt}`);
    expect(out).not.toContain(jwt);
  });

  it("scrubs every planted secret out of a query string", () => {
    for (const secret of PLANTED_SECRETS) {
      const out = redactUrlForLog(`/api/x?v=${encodeURIComponent(secret.literal)}&q=hello`);
      expect(out, `${secret.id} survived redactUrlForLog`).not.toContain(secret.literal);
    }
  });
});
