// F-1's fix (chunk N33/N25 blocker) -- the verification round's own finding
// was that `PUT /api/interview-prep` had ZERO client callers anywhere in the
// app (confirmed by grepping for `method:\s*["']PUT["']` across `app/`,
// which found four unrelated PUTs and none to this route). This file proves
// the production call site AppViewDialog.js now wires PrepPackPanel's
// `onSaveNames` callback to actually exists and issues exactly one PUT with
// the documented body shape: `{applicationId, candidateName,
// interviewerNamesText}` (route.js's own PUT header comment).
//
// `saveTrustedNames` is tested directly, exported for exactly this reason,
// rather than mounting the whole dialog: AppViewDialog.js takes a
// page-sized prop tree (appDialog, applicationData, communicationsDialog,
// digestsById, researchingIds, ...) that has no existing test harness in
// this repo (no AppViewDialog.test.js exists today), and this function IS
// the production call site PrepPackPanel's onSaveNames prop is wired to
// (see AppViewDialog.js's own call to PrepPackPanel, the `onSaveNames={...}`
// prop) -- the same extraction discipline already used for
// `downloadPrepLog`/`onDownloadLog` in this same file.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveTrustedNames } from "./AppViewDialog.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: async () => ({ written: true, error: null }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveTrustedNames -- the sole client caller of PUT /api/interview-prep", () => {
  it("issues exactly one PUT to /api/interview-prep with {applicationId, candidateName, interviewerNamesText}", async () => {
    await saveTrustedNames(APP_ID, { candidateName: "Alex Shaw", interviewerNamesText: "Priya Nair, J. Okafor" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/interview-prep");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      applicationId: APP_ID,
      candidateName: "Alex Shaw",
      interviewerNamesText: "Priya Nair, J. Okafor",
    });
  });

  it("[the F-7 hazard, pinned from the caller's side] a save touching only ONE field still sends the OTHER field's CURRENT value, never omits it -- an omitted field is read by the route as 'clear it' (trustedNames.js's buildTrustedNamesPayload)", async () => {
    // The form the panel hands this function always carries both current
    // values (PrepPackPanel.js's own header) -- this test pins that this
    // function forwards exactly what it is given, verbatim, rather than
    // dropping a field it considers "unchanged".
    await saveTrustedNames(APP_ID, { candidateName: "Alex Shaw", interviewerNamesText: "" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.candidateName).toBe("Alex Shaw");
    expect(Object.prototype.hasOwnProperty.call(body, "interviewerNamesText")).toBe(true);
  });

  it("resolves with the route's own {written, error} response body", async () => {
    const result = await saveTrustedNames(APP_ID, { candidateName: "Alex Shaw", interviewerNamesText: "" });
    expect(result).toEqual({ written: true, error: null });
  });
});
