import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A hand-rolled `google.auth.OAuth2` stand-in, not a fake Drive client: this
// file tests driveOAuth.js's own construction and OAuth calls, so the thing
// under the microscope is *what shape of argument reaches the real
// constructor* (AC-R9's options-object form) and *what generateAuthUrl /
// getToken / revokeToken were called with* -- not Drive's file API at all.
// `vi.hoisted` because the mock factory below is itself hoisted above these
// declarations by vitest.
const box = vi.hoisted(() => ({
  instances: [],
  generateAuthUrlImpl: () => "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
  getTokenImpl: async () => ({ tokens: { access_token: "at", refresh_token: "rt", expiry_date: 123 } }),
  revokeTokenImpl: async () => ({ data: { success: true } }),
}));

vi.mock("googleapis", () => {
  const OAuth2 = vi.fn(function (...args) {
    this.__ctorArgs = args;
    this.generateAuthUrl = vi.fn((...a) => box.generateAuthUrlImpl(...a));
    this.getToken = vi.fn((...a) => box.getTokenImpl(...a));
    this.revokeToken = vi.fn((...a) => box.revokeTokenImpl(...a));
    box.instances.push(this);
  });
  return { google: { auth: { OAuth2 } } };
});

import { google } from "googleapis";
import {
  driveConfig,
  createDriveOAuthClient,
  driveAuthUrl,
  exchangeCode,
  revokeToken,
} from "./driveOAuth.js";
import { DRIVE_SCOPES } from "./driveMime.js";

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "client-id-123.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-client-secret";

  box.instances = [];
  box.generateAuthUrlImpl = () => "https://accounts.google.com/o/oauth2/v2/auth?mock=1";
  box.getTokenImpl = async () => ({ tokens: { access_token: "at", refresh_token: "rt", expiry_date: 123 } });
  box.revokeTokenImpl = async () => ({ data: { success: true } });
  google.auth.OAuth2.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("driveConfig", () => {
  it("reports configured:true and the exact env values when both are set", () => {
    expect(driveConfig()).toEqual({
      clientId: "client-id-123.apps.googleusercontent.com",
      clientSecret: "shh-client-secret",
      configured: true,
    });
  });

  it("reports configured:false with null fields when both are unset -- and never throws", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => driveConfig()).not.toThrow();
    expect(driveConfig()).toEqual({ clientId: null, clientSecret: null, configured: false });
  });

  it("reports configured:false when only the secret is missing (AC-C22)", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(driveConfig().configured).toBe(false);
  });

  it("reports configured:false when only the id is missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(driveConfig().configured).toBe(false);
  });
});

describe("createDriveOAuthClient", () => {
  it("AC-R9: constructs OAuth2 with the options-object form -- one argument, not three positional ones", () => {
    createDriveOAuthClient("https://app.example.com/api/drive/oauth2callback");

    expect(google.auth.OAuth2.mock.calls.length).toBe(1);
    const args = google.auth.OAuth2.mock.calls[0];
    expect(args.length).toBe(1);
    expect(args[0]).toEqual({
      clientId: "client-id-123.apps.googleusercontent.com",
      clientSecret: "shh-client-secret",
      redirectUri: "https://app.example.com/api/drive/oauth2callback",
    });
  });

  it("threads a genuinely undefined redirectUri through when none is given, rather than a placeholder string", () => {
    createDriveOAuthClient();
    const [options] = google.auth.OAuth2.mock.calls[0];
    expect(options.redirectUri).toBeUndefined();
    expect("redirectUri" in options).toBe(true);
  });

  it("throws a clear, actionable error when unconfigured, and never constructs a client", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => createDriveOAuthClient("https://x/cb")).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/s,
    );
    expect(google.auth.OAuth2.mock.calls.length).toBe(0);
  });
});

describe("driveAuthUrl", () => {
  it("AC-C7/C9a: requests exactly DRIVE_SCOPES -- drive.file and userinfo.email, nothing else", () => {
    driveAuthUrl("https://app.example.com/cb", "the-state-value");

    const instance = box.instances[0];
    expect(instance.generateAuthUrl.mock.calls.length).toBe(1);
    const opts = instance.generateAuthUrl.mock.calls[0][0];
    expect(opts.scope).toEqual(DRIVE_SCOPES);
    expect(opts.scope).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("AC-C9b: access_type=offline and prompt=consent, to receive and force a refresh_token", () => {
    driveAuthUrl("https://app.example.com/cb", "s");
    const opts = box.instances[0].generateAuthUrl.mock.calls[0][0];
    expect(opts.access_type).toBe("offline");
    expect(opts.prompt).toBe("consent");
  });

  it("passes the caller's state through verbatim, and the redirectUri into the client", () => {
    driveAuthUrl("https://app.example.com/cb", "opaque-state-xyz");
    const [ctorOptions] = google.auth.OAuth2.mock.calls[0];
    const opts = box.instances[0].generateAuthUrl.mock.calls[0][0];
    expect(ctorOptions.redirectUri).toBe("https://app.example.com/cb");
    expect(opts.state).toBe("opaque-state-xyz");
  });

  it("returns whatever generateAuthUrl produced", () => {
    box.generateAuthUrlImpl = () => "https://accounts.google.com/DISTINCTIVE-MOCK-URL";
    expect(driveAuthUrl("https://x/cb", "s")).toBe("https://accounts.google.com/DISTINCTIVE-MOCK-URL");
  });
});

describe("exchangeCode", () => {
  it("exchanges the code and returns the raw tokens object, unmodified", async () => {
    const rawTokens = { access_token: "AT1", refresh_token: "RT1", expiry_date: 999, scope: "s" };
    box.getTokenImpl = async () => ({ tokens: rawTokens });

    const result = await exchangeCode("https://app.example.com/cb", "auth-code-abc");

    expect(result).toBe(rawTokens);
    expect(box.instances[0].getToken.mock.calls).toEqual([["auth-code-abc"]]);
  });

  it("builds the client against the given redirectUri before exchanging", async () => {
    await exchangeCode("https://exact-redirect.example.com/cb", "code");
    const [ctorOptions] = google.auth.OAuth2.mock.calls[0];
    expect(ctorOptions.redirectUri).toBe("https://exact-redirect.example.com/cb");
  });

  it("propagates a failed exchange rather than swallowing it", async () => {
    const err = new Error("invalid_grant");
    box.getTokenImpl = async () => {
      throw err;
    };

    await expect(exchangeCode("https://x/cb", "bad-code")).rejects.toThrow("invalid_grant");
  });
});

describe("revokeToken", () => {
  it("AC-C19a: posts the given token to Google's revoke endpoint and reports success", async () => {
    const result = await revokeToken("stored-refresh-token-value");

    expect(box.instances[0].revokeToken.mock.calls).toEqual([["stored-refresh-token-value"]]);
    expect(result).toEqual({ revoked: true, error: null });
  });

  it("reports revoked:true, error:null on a successful call", async () => {
    const result = await revokeToken("t");
    expect(result).toEqual({ revoked: true, error: null });
  });

  it("AC-C19b: a failed revocation reports revoked:false with a message, and never throws", async () => {
    box.revokeTokenImpl = async () => {
      throw new Error("network exploded");
    };

    await expect(revokeToken("t")).resolves.toEqual({ revoked: false, error: "network exploded" });
  });

  it("never constructs the client bound to a redirect URI -- revocation has no callback", async () => {
    await revokeToken("t");
    const [ctorOptions] = google.auth.OAuth2.mock.calls[0];
    expect(ctorOptions.redirectUri).toBeUndefined();
  });
});

describe("no coupling to the Gmail OAuth chunk (source sweep)", () => {
  const rawSource = readFileSync(fileURLToPath(new URL("./driveOAuth.js", import.meta.url)), "utf8");
  // The header comment deliberately NAMES gmailClient/GMAIL_SCOPES/getServerEnv
  // in prose, explaining what NOT to do -- so the sweep below runs against
  // whole-line comments stripped out, leaving only executable code. A
  // trailing "// ..." on a code line does not occur anywhere in this file.
  const code = rawSource
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("never imports lib/gmail/gmailClient.js or its scope constant in actual code", () => {
    expect(code).not.toMatch(/gmailClient/);
    expect(code).not.toMatch(/GMAIL_SCOPES/);
  });

  it("never reads credentials through getServerEnv in actual code (AC-C22)", () => {
    expect(code).not.toMatch(/getServerEnv/);
  });

  it("never uses the deprecated positional OAuth2 constructor in actual code", () => {
    expect(code).not.toMatch(/OAuth2\(\s*[a-zA-Z_.]+\s*,\s*[a-zA-Z_.]+\s*,/);
  });

  it("positive control: the sweep pattern actually matches the deprecated form when present", () => {
    const deprecated = "new google.auth.OAuth2(clientId, clientSecret, redirectUri);";
    expect(deprecated).toMatch(/OAuth2\(\s*[a-zA-Z_.]+\s*,\s*[a-zA-Z_.]+\s*,/);
  });
});
