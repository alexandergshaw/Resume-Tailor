// @vitest-environment jsdom
//
// triggerBlobDownload's own contract, which nothing exercised before this
// file existed.
//
// It has six callers and every test that touches one of them MOCKS it -
// BulkActionsBar.test.js says so explicitly, and AttachmentPanel.download.test.js
// stubs it too - because jsdom implements neither URL.createObjectURL nor a
// real download. So the function itself was the one part of the download path
// with no coverage at all, which is how it kept a leak for six callers'
// worth of use.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerBlobDownload } from "./download.js";
import { triggerBlobDownload as reExportedFromDocx } from "./docx.js";

let createdUrls;
let revokedUrls;

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];
  // jsdom has neither of these at all, so they are installed rather than
  // spied on.
  URL.createObjectURL = vi.fn((blob) => {
    const url = `blob:mock/${createdUrls.length}`;
    createdUrls.push({ url, blob });
    return url;
  });
  URL.revokeObjectURL = vi.fn((url) => revokedUrls.push(url));
});

afterEach(() => {
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// The anchor triggerBlobDownload builds is removed before it returns, so it
// cannot be found afterwards. Capturing it at click time is the only way to
// see what it actually carried.
function captureAnchor({ throwOnClick = false } = {}) {
  const seen = [];
  const realClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function patchedClick() {
    seen.push({
      href: this.getAttribute("href"),
      download: this.getAttribute("download"),
      // Whether it was actually in the document AT CLICK TIME. Firefox has
      // historically ignored a click on a detached anchor, which is why the
      // helper appends before clicking and removes after.
      connected: this.isConnected,
      // ORDER IS THE CONTRACT, and it is only observable from in here.
      // Revoking before the click leaves every end-state assertion in this
      // file satisfied - one URL created, the same one revoked, the same
      // href on the anchor - while the blob the browser is asked to save no
      // longer exists, so the download silently produces nothing. Reading
      // the revoke list at click time is what tells those two apart.
      revokedSoFar: revokedUrls.length,
    });
    if (throwOnClick) throw new Error("click failed");
  };
  return {
    seen,
    restore: () => {
      window.HTMLAnchorElement.prototype.click = realClick;
    },
  };
}

describe("triggerBlobDownload", () => {
  it("saves the blob under the given name and cleans up after itself", async () => {
    const blob = new Blob(["bytes"]);
    const anchor = captureAnchor();
    try {
      triggerBlobDownload(blob, "café report (v2).pdf");
    } finally {
      anchor.restore();
    }

    expect(createdUrls).toHaveLength(1);
    expect(createdUrls[0].blob).toBe(blob);
    expect(anchor.seen).toHaveLength(1);
    expect(anchor.seen[0].href).toBe(createdUrls[0].url);
    // The name is set as-is. There is no encoding layer here, which is the
    // whole reason this path is used instead of a signed URL's download
    // parameter.
    expect(anchor.seen[0].download).toBe("café report (v2).pdf");
    expect(anchor.seen[0].connected).toBe(true);
    // The blob must still be reachable at the moment the click happens.
    expect(anchor.seen[0].revokedSoFar).toBe(0);
    // Cleaned up: the object URL released and the temporary anchor gone.
    expect(revokedUrls).toEqual([createdUrls[0].url]);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("releases the object URL even when the click itself throws", async () => {
    // THE DEFECT THIS FILE WAS WRITTEN FOR. With `revokeObjectURL` sitting
    // after `click()` rather than in a `finally`, a throwing click leaks the
    // object URL - and an object URL keeps its entire Blob alive for as long
    // as the mapping exists, which in a single-page app that never unloads
    // means the rest of the tab's life. A user retrying a failing 100 MB
    // video download a few times pins hundreds of megabytes with no way to
    // get it back. The stray <a> is left in the DOM by the same path.
    const blob = new Blob(["bytes"]);
    const anchor = captureAnchor({ throwOnClick: true });
    try {
      expect(() => triggerBlobDownload(blob, "doomed.pdf")).toThrow("click failed");
    } finally {
      anchor.restore();
    }

    expect(createdUrls).toHaveLength(1);
    expect(revokedUrls).toEqual([createdUrls[0].url]);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("is the very same function docx.js re-exports", async () => {
    // Six callers still import it from lib/document/docx.js. A re-export that
    // is a different function - a wrapper, or a leftover copy of the old body
    // - would leave all of them on the unfixed version while this file's
    // tests stayed green, which is the exact shape of a fix that ships inert.
    expect(reExportedFromDocx).toBe(triggerBlobDownload);
  });
});
