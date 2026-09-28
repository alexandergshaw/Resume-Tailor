// U1 (plan §4) — the Gmail refusal CLASSIFIER, lib/gmail/authFailure.js.
// Binds AC-1 / AC-3 / AC-4. Written to fail RED against HEAD, where no
// classifier exists at all (AC C-0.2, verified: grep of lib/gmail + app/api/gmail
// finds only a test mock of "invalid_grant"). So this whole file fails to
// COLLECT on HEAD (the module does not resolve) — that is the intended red.
//
// WHY THIS IS THE HIGH-VALUE INSTRUMENT (R-A1, the silent collapse): if the
// classifier reads the WRONG field, every provider cause funnels into one
// bucket and the original swallow bug returns wearing a `cause` label, with a
// green suite defending it. Research R-1/R-4 settled the trap:
//   * err.response.data.error is the OAuth code STRING (the one field neither
//     gaxios nor google-auth-library ever mutates) — the field to read.
//   * err.code is the numeric HTTP status (400), NOT the OAuth code — a same-name trap.
//   * err.message is the OAuth code for a plain rejection BUT google-auth-library
//     rewrites it to a JSON blob for the /ReAuth/i case (R-4), so it lies.
// The mutation control below (documented per row) pins that swapping the read to
// err.code OR err.message flips a row's logCode/cause. Each row asserts the FULL
// {cause, logCode} object with toEqual precisely so an err.code swap (which keeps
// the coarse cause the same but changes the fine logCode) cannot survive.
//
// The non-object-throw edge (a thrown string, null, undefined, or a bare number) is
// NOT reached by the Boolean(err.response) gate at all: authFailure.js:44-49 checks
// `!err || typeof err !== "object"` FIRST and returns {reauth_required, unrecognized}
// directly, ahead of any response/network check. That guard exists because a
// non-object thrown value carries no positive evidence of anything — not a provider
// rejection, not a network failure — and the coordinator's ruling is that
// temporarily_unavailable must be a POSITIVE identification of a transient failure,
// never a default for the unidentified. Falling through to Boolean(response) (which
// would happen to read falsy on a non-object too, by coincidence) and landing on
// temporarily_unavailable would keep polling silently and recreate the exact swallow
// this classifier exists to remove. The dedicated tests below pin that exact value
// for the string/null/undefined/number cases; "is TOTAL" keeps its own, wider job —
// closed-set membership and non-empty logCode across a broader adversarial set.

import { describe, it, expect } from "vitest";
import { classifyAuthFailure, GMAIL_AUTH_CAUSES } from "./authFailure.js";

// A provider-rejection error shaped exactly per research R-1: `response` DEFINED,
// the OAuth code a STRING at response.data.error, `code` the numeric HTTP status.
// `message` is set to the code (the faithful plain-rejection shape) UNLESS a test
// overrides it to exercise the R-4 rewrite.
function providerRejection(oauthCode, { message, errorDescription } = {}) {
  return {
    response: {
      status: 400,
      statusText: "Bad Request",
      data: {
        error: oauthCode,
        error_description: errorDescription ?? "The token is no longer valid.",
      },
    },
    code: 400, // numeric HTTP status — the err.code trap (research R-1)
    message: message ?? oauthCode,
  };
}

// A network failure shaped per research R-2: `response` UNDEFINED (the single
// stable discriminant google-auth-library itself uses, oauth2client.js:377), and
// `code` a STRING OS-level code. The classifier must gate on Boolean(response)
// only and must NOT enumerate the OS code.
function networkFailure(osCode = "ECONNREFUSED") {
  return {
    response: undefined,
    code: osCode,
    message: `request to https://oauth2.googleapis.com/token failed, reason: ${osCode}`,
  };
}

describe("classifyAuthFailure — the coarse cause + fine logCode mapping (AC-1/AC-3/AC-4)", () => {
  it("row 1 — no stored tokens is an ordinary disconnected state, not an error (AC-3 i)", () => {
    expect(classifyAuthFailure({ kind: "no-tokens" })).toEqual({
      cause: "not_connected",
      logCode: "no_tokens",
    });
  });

  it("row 2 — invalid_grant (plain shape) means reauth (AC-3 ii)", () => {
    // Mutation control: this row's toEqual pins the FULL object. An err.code swap
    // reads 400 (not "invalid_grant") → falls through to unrecognized → logCode
    // "unrecognized" ≠ "invalid_grant" → this row goes red. (The coarse cause
    // stays reauth_required either way, which is exactly why asserting the cause
    // alone would MISS this swap — the logCode is the discriminator.)
    expect(
      classifyAuthFailure({ kind: "refresh-error", error: providerRejection("invalid_grant") }),
    ).toEqual({ cause: "reauth_required", logCode: "invalid_grant" });
  });

  it("row 2b — invalid_grant whose message was REWRITTEN by the library (R-4) still means reauth", () => {
    // This is the faithful shape of google-auth-library's ReAuth rewrite: the
    // library replaces err.message with JSON.stringify(response.data) while
    // LEAVING response.data.error untouched (research R-4, oauth2client.js:261-269).
    // No trigger word is put in error_description; the post-rewrite object is
    // constructed directly, so the fixture does not depend on running the library.
    //
    // Mutation control for the err.message swap: here message is a JSON blob, NOT
    // "invalid_grant". A classifier reading err.message → no match → unrecognized →
    // logCode "unrecognized" ≠ "invalid_grant" → red. A classifier reading
    // err.response.data.error → "invalid_grant" → this row passes. This row is the
    // only thing that kills the message-swap mutant, because for a PLAIN rejection
    // production sets message == the code (research R-1), so row 2 alone cannot.
    const rewritten = providerRejection("invalid_grant", {
      message: '{"error":"invalid_grant","error_description":"The token is no longer valid."}',
    });
    expect(
      classifyAuthFailure({ kind: "refresh-error", error: rewritten }),
    ).toEqual({ cause: "reauth_required", logCode: "invalid_grant" });
  });

  it("row 3 — invalid_client is an OPERATOR failure: transient to the user, distinct in the log (AC-4, F-2)", () => {
    // The one place the two axes diverge: the user sees temporarily_unavailable
    // (their reconnect cannot fix a rotated secret) but the operator log keeps
    // invalid_client so someone can rotate it. Mutation control: an err.code swap
    // gives cause reauth_required (400 → unrecognized fall-through) ≠
    // temporarily_unavailable → red; and the logCode "invalid_client" is lost.
    expect(
      classifyAuthFailure({ kind: "refresh-error", error: providerRejection("invalid_client") }),
    ).toEqual({ cause: "temporarily_unavailable", logCode: "invalid_client" });
  });

  it("row 4 — a network failure (no HTTP response) is transient: keep polling (AC-3 iii)", () => {
    // Gated on Boolean(response) only. The OS code string is present but must not
    // be read for classification (brief: do NOT enumerate OS error codes).
    expect(
      classifyAuthFailure({ kind: "refresh-error", error: networkFailure("ECONNREFUSED") }),
    ).toEqual({ cause: "temporarily_unavailable", logCode: "network" });
  });

  it("row 4b — a different OS code is still just 'network' (the code is not enumerated)", () => {
    // If a build classified by enumerating specific OS strings, a code it did not
    // list would fall elsewhere. Boolean(response)-only makes every response-less
    // failure identical.
    expect(
      classifyAuthFailure({ kind: "refresh-error", error: networkFailure("ETIMEDOUT") }),
    ).toEqual({ cause: "temporarily_unavailable", logCode: "network" });
  });

  it("row 5 — an unrecognised provider code fails toward a VISIBLE remedy, never silence (AC-3 iv)", () => {
    // This is the realistic "unrecognised persistent failure" AC-3(iv) exists for:
    // a GaxiosError WITH a response but a code we do not enumerate
    // (admin_policy_enforced is a real Google code, research R-6). It must default
    // to reauth_required — NOT temporarily_unavailable (which would keep polling a
    // dead connection silently and re-create the swallow bug), and NOT an empty
    // success. Mutation control: flipping this default to temporarily_unavailable
    // is the exact regression AC-3(iv) forbids, and this row goes red on it.
    expect(
      classifyAuthFailure({
        kind: "refresh-error",
        error: providerRejection("admin_policy_enforced"),
      }),
    ).toEqual({ cause: "reauth_required", logCode: "unrecognized" });
  });

  it("row 5b — a provider response with NO data.error string also fails toward reauth", () => {
    // A truthy response whose body carries no OAuth code string. Still 'has a
    // response' (not network) but nothing to switch on → unrecognized → reauth.
    expect(
      classifyAuthFailure({
        kind: "refresh-error",
        error: { response: { status: 500, data: {} }, code: 500, message: "Request failed with status code 500" },
      }),
    ).toEqual({ cause: "reauth_required", logCode: "unrecognized" });
  });

  describe("a non-object thrown value classifies to EXACTLY reauth_required/unrecognized (N88)", () => {
    // Regression guard, not defect coverage: the fresh verifier on 3b574e0 confirmed
    // all four cases below already behave correctly on HEAD — nothing here is red
    // for a present defect. Their job is to catch a FUTURE regression: deleting the
    // non-object guard at authFailure.js:44-49 lets these fall through to
    // Boolean(err.response), which reads falsy on every one of them too, so they'd
    // silently reclassify as temporarily_unavailable — the exact forbidden default
    // this classifier exists to prevent (see the file header). The "is TOTAL" test
    // below deliberately asserts only membership + a non-empty logCode, which is why
    // it cannot catch that mutant; these rows assert the exact object with toEqual.
    it.each([
      ["a string", "boom"],
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
    ])("%s", (_label, thrown) => {
      expect(classifyAuthFailure({ kind: "refresh-error", error: thrown })).toEqual({
        cause: "reauth_required",
        logCode: "unrecognized",
      });
    });
  });

  it("is TOTAL: never throws, and always returns a valid coarse cause, for adversarial input", () => {
    // This test's job is breadth, not the non-object-throw VALUE — that value is
    // pinned exactly by the dedicated describe block above (N88). Here, what's
    // checked is that the classifier is total and its cause is always in the closed
    // vocabulary across a wider adversarial set, so no input strands the caller in
    // an undefined/empty state.
    const weird = [
      { kind: "refresh-error", error: "boom" },
      { kind: "refresh-error", error: null },
      { kind: "refresh-error", error: undefined },
      { kind: "refresh-error", error: 42 },
      { kind: "refresh-error", error: {} },
      { kind: "refresh-error" },
    ];
    for (const input of weird) {
      const result = classifyAuthFailure(input);
      expect(result, `threw or returned nothing for ${JSON.stringify(input)}`).toBeTruthy();
      expect(GMAIL_AUTH_CAUSES).toContain(result.cause);
      expect(typeof result.logCode).toBe("string");
      expect(result.logCode.length).toBeGreaterThan(0);
    }
  });

  it("exposes the closed client-facing cause vocabulary, exactly the three coarse codes", () => {
    // Closed in both directions — a fourth cause, or a missing one, fails here.
    expect([...GMAIL_AUTH_CAUSES].sort()).toEqual(
      ["not_connected", "reauth_required", "temporarily_unavailable"].sort(),
    );
  });

  it("never leaks the fine server-only logCode into the client cause vocabulary", () => {
    // logCode values (no_tokens, invalid_grant, invalid_client, network,
    // unrecognized) are operator-only. None may appear in the client-facing set —
    // catches a build that accidentally returns the fine code as the coarse cause.
    for (const fine of ["no_tokens", "invalid_grant", "invalid_client", "network", "unrecognized"]) {
      expect(GMAIL_AUTH_CAUSES).not.toContain(fine);
    }
  });
});
