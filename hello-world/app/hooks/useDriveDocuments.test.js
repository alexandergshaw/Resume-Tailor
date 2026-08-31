import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveDriveStatus,
  errorKindFromRouteCode,
  buildDownloadResult,
  computeCurrentHash,
} from "./useDriveDocuments.js";

const HOOK = new URL("./useDriveDocuments.js", import.meta.url);
const read = () => readFileSync(HOOK, "utf8");

// R-279's own recorded trap (also caught live in this feature by
// WAVE3-SEAMS.md M-3, against DriveOverwriteDialog.test.js): a sweep that
// searches the raw file text is satisfied by the WORD appearing in a
// comment explaining why the code does NOT do the thing -- exactly what
// this hook's own header does ("The status route already renames
// `google_email` -> `email`"). Strip both `//` lines and `/** */` blocks
// before searching, so this test can only pass against the absence of a
// live reference, not a comment about one.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// deriveDriveStatus — the ten-member enum, one ordered derivation.
// ---------------------------------------------------------------------------

describe("deriveDriveStatus", () => {
  const base = {
    configured: true,
    connected: true,
    pendingConsent: false,
    driveBusy: false,
    prompt: null,
    reconnectNeeded: false,
    statusCheckFailed: false,
  };

  it("unconfigured when configured === false, regardless of connected", () => {
    expect(deriveDriveStatus({ ...base, configured: false })).toBe("unconfigured");
  });

  it("checking while configured is still unresolved", () => {
    expect(deriveDriveStatus({ ...base, configured: null, connected: null })).toBe("checking");
  });

  it("checking while connected is still unresolved (configured already known)", () => {
    expect(deriveDriveStatus({ ...base, connected: null })).toBe("checking");
  });

  it("statusFailed when the initial call failed and connected never resolved", () => {
    expect(
      deriveDriveStatus({ ...base, connected: null, statusCheckFailed: true }),
    ).toBe("statusFailed");
  });

  // BLOCKER-1 (WAVE5-SEAMS.md): the ONLY place that sets statusCheckFailed
  // true (useDriveDocuments.js's mount effect) leaves `configured` at its
  // initial `null` -- the failed fetch never resolves it. A version of this
  // function that checks `configured === null` before `statusCheckFailed`
  // can never reach "statusFailed" in real use, because this exact
  // combination -- configured AND connected both still null -- is the one
  // the real failure path always produces.
  it("statusFailed wins over checking even when configured is ALSO still null -- the actual shape a real failed fetch produces", () => {
    expect(
      deriveDriveStatus({ ...base, configured: null, connected: null, statusCheckFailed: true }),
    ).toBe("statusFailed");
  });

  it("disconnected when configured but not connected", () => {
    expect(deriveDriveStatus({ ...base, connected: false })).toBe("disconnected");
  });

  it("tokenRejected takes priority over plain disconnected", () => {
    expect(deriveDriveStatus({ ...base, connected: false, reconnectNeeded: true })).toBe(
      "tokenRejected",
    );
  });

  it("connected when configured, connected, and nothing else is happening", () => {
    expect(deriveDriveStatus(base)).toBe("connected");
  });

  it("consentPending overrides disconnected while the popup is open", () => {
    expect(
      deriveDriveStatus({ ...base, connected: false, pendingConsent: true }),
    ).toBe("consentPending");
  });

  it("saving overrides connected while a batch is in flight", () => {
    expect(deriveDriveStatus({ ...base, driveBusy: true })).toBe("saving");
  });

  it("promptPending is checked FIRST, ahead of saving and consentPending", () => {
    expect(
      deriveDriveStatus({
        ...base,
        driveBusy: true,
        pendingConsent: true,
        prompt: { id: "x", docNames: ["A"] },
      }),
    ).toBe("promptPending");
  });
});

// ---------------------------------------------------------------------------
// errorKindFromRouteCode — MAJ-13's normalisation. This is the seam that
// makes driveSaveBatch's connectionLost (checking errorKind === "reconnect"
// literally) actually fire for the route's "not_connected" code.
// ---------------------------------------------------------------------------

describe("errorKindFromRouteCode", () => {
  it("maps not_connected to reconnect -- the exact string driveSaveBatch checks for connectionLost", () => {
    expect(errorKindFromRouteCode("not_connected")).toBe("reconnect");
  });

  it("maps every other route code to driveSaveBatch's own vocabulary", () => {
    expect(errorKindFromRouteCode("drive_storage_full")).toBe("storage-full");
    expect(errorKindFromRouteCode("drive_refused")).toBe("refused");
    expect(errorKindFromRouteCode("drive_transient")).toBe("transient");
    expect(errorKindFromRouteCode("drive_gone")).toBe("gone");
  });

  it("falls back to unknown for anything unrecognised, including undefined", () => {
    expect(errorKindFromRouteCode("drive_storage_unavailable")).toBe("unknown");
    expect(errorKindFromRouteCode("drive_not_converted")).toBe("unknown");
    expect(errorKindFromRouteCode(undefined)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// buildDownloadResult — the download path's own tiny reducer (deliberately
// not driveSaveBatch -- see the header comment on that function).
// ---------------------------------------------------------------------------

describe("buildDownloadResult", () => {
  it("returns a STRUCTURED leadingLine descriptor on a full success, never a string", () => {
    const result = buildDownloadResult({ downloadedCount: 2, failures: [] });
    expect(result.leadingLine).toEqual({ kind: "downloaded", count: 2 });
    expect(typeof result.leadingLine).not.toBe("string");
    expect(result.rows).toEqual([]);
    expect(result.announcement.polite).toBe("Downloaded 2 documents from Drive.");
    expect(result.announcement.alert).toBe("");
  });

  it("singular count phrasing", () => {
    const result = buildDownloadResult({ downloadedCount: 1, failures: [] });
    expect(result.announcement.polite).toBe("Downloaded 1 document from Drive.");
  });

  it("a total failure has a null leadingLine and the failure's own message on the alert side", () => {
    const result = buildDownloadResult({
      downloadedCount: 0,
      failures: [{ scope: "cover", message: "That Google Doc is no longer in your Drive. Save again to create a new one.", errorKind: "gone" }],
    });
    expect(result.leadingLine).toBeNull();
    expect(result.announcement.polite).toBe("");
    expect(result.announcement.alert).toContain("no longer in your Drive");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].kind).toBe("error");
    expect(result.rows[0].scope).toBe("cover");
  });

  it("a partial batch keeps the successes in the leading line and shows only the failure count on the alert side", () => {
    const result = buildDownloadResult({
      downloadedCount: 1,
      failures: [{ scope: "cover", message: "x", errorKind: "unknown" }],
    });
    expect(result.leadingLine).toEqual({ kind: "downloaded", count: 1 });
    // Exactly one failure alongside a success shows THAT failure's own
    // message (mirroring driveSaveBatch's single-failure convention), not a
    // generic count -- the generic "N documents weren't downloaded." is
    // reserved for two or more simultaneous failures.
    expect(result.announcement.alert).toBe("x");
  });

  it("two or more simultaneous failures collapse to a generic count, never a running list", () => {
    const result = buildDownloadResult({
      downloadedCount: 0,
      failures: [
        { scope: "resume", message: "resume reason", errorKind: "unknown" },
        { scope: "cover", message: "cover reason", errorKind: "unknown" },
      ],
    });
    expect(result.announcement.alert).toBe("2 documents weren't downloaded.");
    expect(result.rows).toHaveLength(2);
  });

  it("announcement is ALWAYS a complete {polite, alert} object -- never a bare string or split fields", () => {
    const result = buildDownloadResult({ downloadedCount: 0, failures: [] });
    expect(result.announcement).toEqual({ polite: "", alert: "" });
    expect(typeof result.announcement).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// computeCurrentHash -- AC-P6's tuple. This is the single owner of the
// content-hash computation (obligation 5); the tests below prove it is
// sensitive to the inputs a text-only hash would miss.
// ---------------------------------------------------------------------------

describe("computeCurrentHash", () => {
  it("is deterministic for identical inputs", async () => {
    const entry = { result: "RESUME TEXT", resultLines: ["RESUME TEXT"], docxB64: "", docxPath: "", edited: { resume: false, cover: false } };
    const a = await computeCurrentHash(entry, "resume", {});
    const b = await computeCurrentHash(entry, "resume", {});
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when the text changes", async () => {
    const entry = { result: "A", resultLines: ["A"], docxB64: "", docxPath: "", edited: { resume: false, cover: false } };
    const a = await computeCurrentHash(entry, "resume", {});
    const b = await computeCurrentHash(entry, "resume", { text: "B" });
    expect(a).not.toBe(b);
  });

  it("changes on a version switch (docxPath changes) even though the text is identical -- AC-P6's whole reason for existing", () => {
    return (async () => {
      const base = { result: "SAME TEXT", resultLines: ["SAME TEXT"], docxB64: "", edited: { resume: false, cover: false } };
      const a = await computeCurrentHash({ ...base, docxPath: "user-1/generated/r1.docx" }, "resume", {});
      const b = await computeCurrentHash({ ...base, docxPath: "user-1/generated/r2.docx" }, "resume", {});
      // A text-only hash (the mistake AC-P6 exists to prevent) would make
      // these equal -- this is the assertion that would fail under that bug.
      expect(a).not.toBe(b);
    })();
  });

  it("changes on a template swap when the branch that reads the template is the one active", async () => {
    const entry = { result: "SAME TEXT", resultLines: ["SAME TEXT"], docxB64: "", docxPath: "", edited: { resume: false, cover: false } };
    const fileA = { arrayBuffer: async () => new TextEncoder().encode("TEMPLATE A").buffer };
    const fileB = { arrayBuffer: async () => new TextEncoder().encode("TEMPLATE B").buffer };
    const a = await computeCurrentHash(entry, "resume", { resumeFile: fileA });
    const b = await computeCurrentHash(entry, "resume", { resumeFile: fileB });
    expect(a).not.toBe(b);
  });

  it("returns null for the email scope -- there is no docx-backed document to hash", async () => {
    const entry = { emailResultLines: ["hi"], emailSubject: "Hello" };
    expect(await computeCurrentHash(entry, "email", {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// [src] — obligation 1: consume `email` as the status route already renames
// it; never re-derive it from the `google_email` column name.
// ---------------------------------------------------------------------------

describe("[src] obligation 1 -- status route's renamed field", () => {
  it("the raw source mentions google_email only in prose, never as a live reference", () => {
    // Positive control for the absence assertion below: the word DOES
    // appear in the raw file (the header comment cites it by name), so a
    // sweep that forgot to strip comments would pass by accident. Without
    // this line, stripping comments and finding nothing would be
    // indistinguishable from a sweep that never ran at all.
    expect(read()).toMatch(/google_email/);
  });

  it("never references the raw google_email column name in live code", () => {
    expect(stripComments(read())).not.toMatch(/google_email/);
  });

  it("reads the status route's own renamed field instead", () => {
    expect(read()).toMatch(/body\.email/);
  });
});

// ---------------------------------------------------------------------------
// [src] — file stays under the feature's own line ceiling (AC-R1's shape).
// ---------------------------------------------------------------------------

describe("[src] AC-R1 -- line ceiling", () => {
  it("is under 1000 lines", () => {
    const lines = read().split("\n").length;
    expect(lines).toBeLessThan(1000);
  });
});
