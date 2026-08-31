import { describe, it, expect } from "vitest";
import {
  DRIVE_SAVE_LABEL,
  saveControlLabel,
  DRIVE_SETTINGS_LABEL,
  DRIVE_IN_YOUR_DRIVE,
  savedSummary,
  partialSavedSummary,
  downloadedSummary,
  savedRowPrefix,
  savedAsNewDocFragments,
  replacedRowText,
  coverNoBytesRow,
  dismissedRow,
  scopeFailureRow,
  DRIVE_CONVERSION_CAPTION,
  DRIVE_STALE_CAPTION,
  DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION,
  hiringEmailDriveNote,
  DRIVE_FOLDER_CAPTION,
  DRIVE_DISCONNECT_NOTE,
  DRIVE_DOWNLOAD_LABEL,
  DRIVE_BATCH_MESSAGE,
  driveErrorMessage,
  DRIVE_ANNOUNCE,
  driveAnnounceStart,
  overwriteHeading,
  overwriteBody,
  saveAsNewDocLabel,
  overwriteDocLabel,
  DRIVE_OVERWRITE_DISMISS_LABEL,
} from "./driveMessages.js";

describe("saveControlLabel", () => {
  it("reads 'Save 2 to Drive' for a connected user with two scopes", () => {
    expect(saveControlLabel({ status: "connected", scopeCount: 2 })).toBe("Save 2 to Drive");
  });

  it("reads 'Save to Drive' -- no count -- for a connected user with one scope", () => {
    const label = saveControlLabel({ status: "connected", scopeCount: 1 });
    expect(label).toBe("Save to Drive");
    expect(label).not.toContain("1");
  });

  it("reads 'Connect Drive & save' when disconnected", () => {
    expect(saveControlLabel({ status: "disconnected" })).toBe(DRIVE_SAVE_LABEL.connectAndSave);
  });

  it("reads 'Connect Drive & save' when the status call failed", () => {
    expect(saveControlLabel({ status: "statusFailed" })).toBe(DRIVE_SAVE_LABEL.connectAndSave);
  });

  it("reads 'Reconnect Drive & save' when the token was rejected", () => {
    expect(saveControlLabel({ status: "tokenRejected" })).toBe("Reconnect Drive & save");
  });

  it("reads 'Waiting for Google…' while the consent window is open", () => {
    expect(saveControlLabel({ status: "consentPending" })).toBe("Waiting for Google…");
  });

  it("reads 'Saving…' while a save is in flight, and while a prompt is pending", () => {
    expect(saveControlLabel({ status: "saving" })).toBe("Saving…");
    expect(saveControlLabel({ status: "promptPending" })).toBe("Saving…");
  });

  it("renders no control at all when unconfigured, checking, or no scopes available", () => {
    expect(saveControlLabel({ status: "unconfigured" })).toBeNull();
    expect(saveControlLabel({ status: "checking" })).toBeNull();
    expect(saveControlLabel({ status: "noScopes" })).toBeNull();
  });
});

describe("DRIVE_SETTINGS_LABEL", () => {
  it("carries the exact DriveButton state strings", () => {
    expect(DRIVE_SETTINGS_LABEL).toEqual({
      checking: "Checking…",
      connect: "Connect Drive",
      connected: "Drive connected",
      disconnect: "Disconnect Drive",
      disconnecting: "Disconnecting…",
    });
  });
});

describe("result region summaries", () => {
  it("DRIVE_IN_YOUR_DRIVE is the idle rehydrated-state text", () => {
    expect(DRIVE_IN_YOUR_DRIVE).toBe("In your Drive");
  });

  it("savedSummary uses singular wording for exactly one document", () => {
    expect(savedSummary(1)).toBe("Saved 1 document to Drive.");
  });

  it("savedSummary uses plural wording for more than one document", () => {
    expect(savedSummary(2)).toBe("Saved 2 documents to Drive.");
  });

  it("partialSavedSummary names both the saved count and the total", () => {
    expect(partialSavedSummary(1, 2)).toBe("Saved 1 of 2 documents to Drive.");
  });

  it("downloadedSummary uses plural wording for more than one document", () => {
    expect(downloadedSummary(2)).toBe("Downloaded 2 documents from Drive.");
  });

  it("downloadedSummary uses singular wording for exactly one document", () => {
    const text = downloadedSummary(1);
    expect(text).toContain("1 document");
    expect(text).not.toContain("documents");
  });
});

describe("per-scope strip rows", () => {
  it("savedRowPrefix reads '<label> — '", () => {
    expect(savedRowPrefix("Resume")).toBe("Resume — ");
    expect(savedRowPrefix("Cover letter")).toBe("Cover letter — ");
  });

  it("savedAsNewDocFragments reproduces the B-3 sentence around two links", () => {
    const [before, between, after] = savedAsNewDocFragments("Resume");
    const linkA = "<link-a>";
    const linkB = "<link-b>";
    expect(before + linkA + between + linkB + after).toBe(
      "Resume — saved to a new Doc: <link-a>. Your earlier Doc, with the changes made in your Drive, is still there: <link-b>.",
    );
  });

  it("replacedRowText names the scope, explains the replacement, and ends with a trailing space for the link that follows", () => {
    expect(replacedRowText("Resume")).toBe(
      "Resume — the previous Doc was no longer in your Drive, so a new one was created. ",
    );
  });

  it("coverNoBytesRow gives the exact recovery sentence, with the scope label as a parameter", () => {
    expect(coverNoBytesRow("Cover letter")).toBe(
      "Cover letter — couldn't rebuild the document. Regenerate the cover letter, or upload your cover letter template (.docx), then save again.",
    );
  });

  it("dismissedRow explains the skip without naming a specific cause", () => {
    expect(dismissedRow("Resume")).toBe(
      "Resume — not saved. The Doc in Drive has changed since the app last saved it.",
    );
  });

  it("scopeFailureRow interpolates the scope label and the reason sentence", () => {
    expect(scopeFailureRow("Cover letter", "Google Drive is busy. Try saving again in a moment.")).toBe(
      "Cover letter — wasn't saved. Google Drive is busy. Try saving again in a moment.",
    );
  });
});

describe("DRIVE_DOWNLOAD_LABEL (WAVE3-SEAMS.md M-1: the download control's labels, single-sourced here)", () => {
  it("carries the exact three download-control strings", () => {
    expect(DRIVE_DOWNLOAD_LABEL).toEqual({
      download: "Download from Drive",
      downloadStale: "Download older Drive copy",
      downloading: "Downloading…",
    });
  });
});

describe("captions", () => {
  it("DRIVE_CONVERSION_CAPTION warns about Google Docs formatting differences", () => {
    expect(DRIVE_CONVERSION_CAPTION).toBe(
      "Drive copies are converted by Google Docs and can differ in formatting from the .docx you download here.",
    );
  });

  it("DRIVE_STALE_CAPTION offers Save to update, matching AC-P7's caption", () => {
    expect(DRIVE_STALE_CAPTION).toBe("The Drive copy differs from the document shown here. Save to update it.");
  });

  it("DRIVE_STALE_CAPTION states difference, never an ordering claim (AC-P7)", () => {
    // Positive control first: prove the string actually asserts the
    // property under test, so the absence check below can't pass against a
    // caption that says nothing at all (e.g. an accidentally emptied
    // string).
    expect(DRIVE_STALE_CAPTION).toMatch(/differs from/i);
    // After a page reload the app no longer holds the user's hand-edits, so
    // the Drive copy can legitimately be NEWER than what's on screen -- an
    // ordering claim in either direction would be a lie the app can't back
    // up. None of these words may appear.
    expect(DRIVE_STALE_CAPTION).not.toMatch(/\b(older|newer|out of date|behind)\b/i);
  });

  it("DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION prompts reconnecting", () => {
    expect(DRIVE_RECONNECT_TO_DOWNLOAD_CAPTION).toBe("Reconnect Drive to download these as .docx.");
  });

  it("hiringEmailDriveNote never mentions a cover letter when only the resume exists", () => {
    const note = hiringEmailDriveNote(1);
    expect(note).toBe("Save to Drive saves your resume — the hiring email isn't a document.");
    expect(note.toLowerCase()).not.toContain("cover letter");
  });

  it("hiringEmailDriveNote mentions both documents when both scopes exist", () => {
    expect(hiringEmailDriveNote(2)).toBe(
      "Save to Drive saves your resume and cover letter — the hiring email isn't a document.",
    );
  });

  it("DRIVE_FOLDER_CAPTION names the Resume Tailor folder with curly quotes", () => {
    expect(DRIVE_FOLDER_CAPTION).toBe('Documents are saved to a “Resume Tailor” folder in your Drive.');
  });

  it("DRIVE_DISCONNECT_NOTE reassures that Docs are not deleted", () => {
    expect(DRIVE_DISCONNECT_NOTE).toBe("Disconnecting only removes this app's access — your Docs stay in Drive.");
  });
});

describe("DRIVE_BATCH_MESSAGE -- the permission-refusal string", () => {
  it("never claims the user has an administrator", () => {
    const message = DRIVE_BATCH_MESSAGE.refused;
    expect(message.toLowerCase()).not.toContain("your administrator");
    expect(message).not.toMatch(/you have an? administrator/i);
  });

  it("frames an organisation policy as conditional ('if'), not asserted fact", () => {
    expect(DRIVE_BATCH_MESSAGE.refused).toContain("If your account is managed by an organisation");
  });

  it("differs from the storage-full message (M-9: must not be conflated)", () => {
    expect(DRIVE_BATCH_MESSAGE.refused).not.toBe(DRIVE_BATCH_MESSAGE.storageFull);
  });

  it("names the exact recovery: check the Resume Tailor folder still exists and is editable", () => {
    expect(DRIVE_BATCH_MESSAGE.refused).toBe(
      "Google Drive wouldn't accept this file. If your account is managed by an organisation, its policy may block this; otherwise check that the “Resume Tailor” folder still exists in your Drive and that you can edit it.",
    );
  });
});

describe("DRIVE_BATCH_MESSAGE -- other verbatim entries", () => {
  it("consentRefused matches AC-E2 verbatim", () => {
    expect(DRIVE_BATCH_MESSAGE.consentRefused).toBe("Drive access wasn't granted — nothing was saved.");
  });

  it("offline matches AC-E13a verbatim", () => {
    expect(DRIVE_BATCH_MESSAGE.offline).toBe("Couldn't reach Google Drive — check your connection.");
  });

  it("reconnectSave and reconnectDownload are two distinct sentences", () => {
    expect(DRIVE_BATCH_MESSAGE.reconnectSave).toBe(
      "Your Drive connection expired. Reconnect and this save will finish on its own.",
    );
    expect(DRIVE_BATCH_MESSAGE.reconnectDownload).toBe("Your Drive connection expired. Reconnect, then download again.");
    expect(DRIVE_BATCH_MESSAGE.reconnectSave).not.toBe(DRIVE_BATCH_MESSAGE.reconnectDownload);
  });

  it("tooLargeUpload does not name a number -- Drive's real 5 TB ceiling must never appear", () => {
    expect(DRIVE_BATCH_MESSAGE.tooLargeUpload).toBe(
      "This document is too large for the app to upload to Drive. Download it as .docx here instead.",
    );
    expect(DRIVE_BATCH_MESSAGE.tooLargeUpload).not.toMatch(/\d/);
  });

  it("tooLargeExport is distinct from tooLargeUpload", () => {
    expect(DRIVE_BATCH_MESSAGE.tooLargeExport).toBe(
      "That Google Doc is too large for the app to download from Drive. Open it in Google Docs and export it there.",
    );
    expect(DRIVE_BATCH_MESSAGE.tooLargeExport).not.toBe(DRIVE_BATCH_MESSAGE.tooLargeUpload);
  });
});

describe("driveErrorMessage", () => {
  it("maps the route's machine codes to their exact UX string", () => {
    expect(driveErrorMessage("Unauthorized")).toBe(DRIVE_BATCH_MESSAGE.appSignedOut);
    expect(driveErrorMessage("drive_storage_full")).toBe(DRIVE_BATCH_MESSAGE.storageFull);
    expect(driveErrorMessage("drive_refused")).toBe(DRIVE_BATCH_MESSAGE.refused);
    expect(driveErrorMessage("drive_transient")).toBe(DRIVE_BATCH_MESSAGE.transient);
    expect(driveErrorMessage("drive_unconfigured")).toBe(DRIVE_BATCH_MESSAGE.misconfigured);
  });

  // WAVE2-SEAMS.md MAJOR-4: `lib/drive/driveSaveBatch.js`'s BATCH_ERROR.UNAUTHORIZED
  // is the lowercase "unauthorized" -- an ADDED alias alongside the
  // capitalised "Unauthorized" apiAuth.js's routes already emit, not a
  // rename of it (the next test pins the capitalised key still resolves).
  it("also maps the lowercase 'unauthorized' -- driveSaveBatch.js's own batch-abort code -- to the same string", () => {
    expect(driveErrorMessage("unauthorized")).toBe(DRIVE_BATCH_MESSAGE.appSignedOut);
    expect(driveErrorMessage("unauthorized")).toBe(driveErrorMessage("Unauthorized"));
  });

  it("positive control: the capitalised 'Unauthorized' key is unchanged -- the lowercase form is an addition, not a rename", () => {
    expect(driveErrorMessage("Unauthorized")).not.toBeNull();
    expect(driveErrorMessage("Unauthorized")).toBe(DRIVE_BATCH_MESSAGE.appSignedOut);
  });

  it("maps classifyDriveError's shorter category names to the same strings", () => {
    expect(driveErrorMessage("storage-full")).toBe(DRIVE_BATCH_MESSAGE.storageFull);
    expect(driveErrorMessage("refused")).toBe(DRIVE_BATCH_MESSAGE.refused);
    expect(driveErrorMessage("transient")).toBe(DRIVE_BATCH_MESSAGE.transient);
  });

  it("disambiguates 'reconnect' by path -- save vs download read differently", () => {
    expect(driveErrorMessage("not_connected", { path: "save" })).toBe(DRIVE_BATCH_MESSAGE.reconnectSave);
    expect(driveErrorMessage("not_connected", { path: "download" })).toBe(DRIVE_BATCH_MESSAGE.reconnectDownload);
    expect(driveErrorMessage("reconnect")).toBe(DRIVE_BATCH_MESSAGE.reconnectSave);
  });

  it("disambiguates 'too large' by path -- upload vs export read differently", () => {
    expect(driveErrorMessage("payload_too_large", { path: "save" })).toBe(DRIVE_BATCH_MESSAGE.tooLargeUpload);
    expect(driveErrorMessage("payload_too_large", { path: "download" })).toBe(DRIVE_BATCH_MESSAGE.tooLargeExport);
  });

  it("maps the 'gone' code -- reachable from both the save and download paths -- to its recovery sentence", () => {
    expect(driveErrorMessage("drive_gone")).toBe(DRIVE_BATCH_MESSAGE.gone);
    expect(driveErrorMessage("gone")).toBe(DRIVE_BATCH_MESSAGE.gone);
  });

  it("maps the client-only popup/consent codes", () => {
    expect(driveErrorMessage("consent-refused")).toBe(DRIVE_BATCH_MESSAGE.consentRefused);
    expect(driveErrorMessage("popup-blocked")).toBe(DRIVE_BATCH_MESSAGE.popupBlocked);
    expect(driveErrorMessage("popup-closed")).toBe(DRIVE_BATCH_MESSAGE.popupClosedNoResult);
    expect(driveErrorMessage("token-unreadable")).toBe(DRIVE_BATCH_MESSAGE.tokenUnreadable);
  });

  it("returns null for a conflict code -- conflicts resolve through the overwrite prompt, not a batch row", () => {
    expect(driveErrorMessage("conflict_foreign")).toBeNull();
    expect(driveErrorMessage("conflict_session")).toBeNull();
  });

  it("returns null for an unrecognised code", () => {
    expect(driveErrorMessage("something_new")).toBeNull();
    expect(driveErrorMessage("unknown")).toBeNull();
  });
});

describe("DRIVE_ANNOUNCE", () => {
  it("carries the exact start-of-action sentences", () => {
    expect(DRIVE_ANNOUNCE.connectStart).toBe("Opening the Google permission window…");
    expect(DRIVE_ANNOUNCE.saveStart).toBe("Saving to Google Drive…");
    expect(DRIVE_ANNOUNCE.exportStart).toBe("Downloading from Google Drive…");
  });

  it("carries the cover-letter partial-failure alert sentence", () => {
    expect(DRIVE_ANNOUNCE.coverNotSavedAlert).toBe("Cover letter wasn't saved: couldn't rebuild the document.");
  });
});

describe("driveAnnounceStart -- rule 7's mechanism (WAVE3-SEAMS.md MAJOR §5)", () => {
  it("save: polite carries DRIVE_ANNOUNCE.saveStart, alert is cleared to '' in the SAME object", () => {
    expect(driveAnnounceStart("save")).toEqual({ polite: DRIVE_ANNOUNCE.saveStart, alert: "" });
  });

  it("connect: polite carries DRIVE_ANNOUNCE.connectStart, alert is cleared", () => {
    expect(driveAnnounceStart("connect")).toEqual({ polite: DRIVE_ANNOUNCE.connectStart, alert: "" });
  });

  it("export: polite carries DRIVE_ANNOUNCE.exportStart, alert is cleared", () => {
    expect(driveAnnounceStart("export")).toEqual({ polite: DRIVE_ANNOUNCE.exportStart, alert: "" });
  });

  it("defaults to the save-start pair for an unrecognised kind, never throwing", () => {
    expect(() => driveAnnounceStart("something-else")).not.toThrow();
    expect(driveAnnounceStart("something-else")).toEqual({ polite: DRIVE_ANNOUNCE.saveStart, alert: "" });
  });

  it("every kind's alert half is always '' -- the structural guarantee this function exists for", () => {
    for (const kind of ["connect", "save", "export"]) {
      expect(driveAnnounceStart(kind).alert).toBe("");
    }
  });
});

describe("overwrite conflict prompt (§5.3) -- DriveOverwriteDialog", () => {
  it("overwriteHeading names the single conflicted Doc in curly quotes", () => {
    expect(overwriteHeading(["Acme - Senior Engineer - Resume"])).toBe(
      "“Acme - Senior Engineer - Resume” has changed in your Drive since this app last saved it.",
    );
  });

  it("overwriteHeading reads a plural sentence -- no Doc name -- for two conflicted Docs", () => {
    expect(overwriteHeading(["Resume", "Cover Letter"])).toBe(
      "Both Docs have changed in your Drive since this app last saved them.",
    );
  });

  it("overwriteBody hedges singular: an edit, a rename, a move, or a comment", () => {
    expect(overwriteBody(["Resume"])).toBe(
      "That could be an edit, or just a rename, a move, or a comment — the app can't tell which. Overwriting replaces whatever is in the Doc now, and this app can't undo it.",
    );
  });

  it("overwriteBody hedges plural: edits, renames, moves, or comments", () => {
    expect(overwriteBody(["Resume", "Cover Letter"])).toBe(
      "That could be edits, or just renames, moves, or comments — the app can't tell which. Overwriting replaces whatever is in the Docs now, and this app can't undo it.",
    );
  });

  it("saveAsNewDocLabel is 'Save as a new Doc' singular and 'Save as new Docs' plural", () => {
    expect(saveAsNewDocLabel(["Resume"])).toBe("Save as a new Doc");
    expect(saveAsNewDocLabel(["Resume", "Cover Letter"])).toBe("Save as new Docs");
  });

  it("overwriteDocLabel is 'Overwrite the Doc' singular and 'Overwrite the Docs' plural", () => {
    expect(overwriteDocLabel(["Resume"])).toBe("Overwrite the Doc");
    expect(overwriteDocLabel(["Resume", "Cover Letter"])).toBe("Overwrite the Docs");
  });

  it("DRIVE_OVERWRITE_DISMISS_LABEL ('Not now') never pluralises -- UX.md gives it one form", () => {
    expect(DRIVE_OVERWRITE_DISMISS_LABEL).toBe("Not now");
  });

  it("singular/plural derives from docNames.length alone, so an empty array reads as singular (no crash on names[0])", () => {
    expect(overwriteHeading([])).toBe("“” has changed in your Drive since this app last saved it.");
  });
});
