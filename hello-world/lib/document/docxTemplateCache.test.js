// @vitest-environment jsdom
//
// `buildTemplateLinesForUpload` must not re-unzip and re-parse the same file.
//
// THE MEASURED DEFECT. `lib/chat/chatbot.js`'s `runChatRequest` calls
// `buildTemplateLinesForUpload(resumeFile)` on EVERY send, which runs
// `JSZip.loadAsync` + `DOMParser.parseFromString` over `word/document.xml`
// (docx.js's `extractTemplateLinesFromDocx`) on the MAIN THREAD, before the
// request leaves the browser. The same immutable file, the same bytes, the same
// answer, re-derived once per typed message -- and it is not only chat:
// app/page.js, useDocumentPreview.js, useManualTailor.js and
// useApplicationDialogs.js all call it too, several of them twice in a row for
// a resume and a cover letter.
//
// WHY A MODULE-LEVEL CACHE AND NOT A HOOK. `createChatHandlers` is re-invoked
// on every render, so anything memoized inside it is thrown away roughly as
// often as it is built. A `WeakMap` keyed on the `File` in the module that owns
// the parse survives re-render, is shared by every caller, and is collected
// with the File itself.
//
// WHY KEYING ON THE FILE IS SOUND. A `File`/`Blob` is immutable by
// specification: its bytes, `size` and `lastModified` are fixed at
// construction. A user who edits the document on disk and re-picks it hands the
// app a NEW `File` object, which is a new key. There is no shape in which the
// same `File` reference legitimately yields two different documents.

import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { buildTemplateLinesForUpload } from "./docx.js";

// --- fixtures ---------------------------------------------------------------

// Written out rather than imported from docx.js's `WORDPROCESSINGML_NS`: that
// export currently has no consumer outside its own module and is carried on
// lib/sourceScan/exportReachability.sweep.test.js's orphan ledger by exact
// count, so importing it here would move it between that sweep's buckets and
// fail a repo-wide gate that has nothing to do with this change.
const WORDPROCESSINGML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function documentXml(lines) {
  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORDPROCESSINGML_NS}"><w:body>${paragraphs}</w:body></w:document>`;
}

async function docxBytes(lines) {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml(lines));
  return zip.generateAsync({ type: "arraybuffer" });
}

/**
 * A File-shaped object whose reads are COUNTED. Not a real `File`: jsdom's
 * `File.arrayBuffer` cannot be spied on per-instance, and the count is the
 * whole instrument here. `buildTemplateLinesForUpload` only ever touches
 * `name`, `arrayBuffer()` and `text()`, and a plain object is a perfectly good
 * WeakMap key.
 */
function countingDocx(name, bytes) {
  const handle = {
    name,
    arrayBuffer: vi.fn(async () => bytes),
  };
  return handle;
}

function countingText(name, text) {
  return { name, text: vi.fn(async () => text) };
}

const RESUME_LINES = ["Alex Shaw", "Senior Data Engineer", "• Cut nightly ETL runtime 62%"];

// ---------------------------------------------------------------------------
// The instrument itself, before anything is asserted with it.
// ---------------------------------------------------------------------------

describe("[instrument] the fixture really is parsed, and the counter really counts", () => {
  // Without this block every "called once" assertion below could be satisfied
  // by a fixture that yields nothing and a spy that never fires -- a cache that
  // returns an empty array is infinitely fast and completely wrong.
  it("really unzips and really parses: one read, and the actual paragraphs back", async () => {
    const bytes = await docxBytes(RESUME_LINES);
    const handle = countingDocx("resume.docx", bytes);
    expect(await buildTemplateLinesForUpload(handle)).toEqual(RESUME_LINES);
    expect(handle.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("counts one read per file, so the counter is not stuck at one", async () => {
    // Three separate files, three parses. A spy wired wrong -- or a counter
    // that saturates -- shows up here rather than masquerading as a cache hit.
    const bytes = await docxBytes(RESUME_LINES);
    const handles = ["a.docx", "b.docx", "c.docx"].map((name) => countingDocx(name, bytes));
    for (const handle of handles) await buildTemplateLinesForUpload(handle);
    const total = handles.reduce((n, h) => n + h.arrayBuffer.mock.calls.length, 0);
    expect(total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The change.
// ---------------------------------------------------------------------------

describe("buildTemplateLinesForUpload reads each file exactly once", () => {
  it("parses a .docx once no matter how many sends ask for its lines", async () => {
    const bytes = await docxBytes(RESUME_LINES);
    const resume = countingDocx("resume.docx", bytes);

    const first = await buildTemplateLinesForUpload(resume);
    const second = await buildTemplateLinesForUpload(resume);
    const third = await buildTemplateLinesForUpload(resume);

    expect(first).toEqual(RESUME_LINES);
    expect(second).toEqual(RESUME_LINES);
    expect(third).toEqual(RESUME_LINES);
    expect(
      resume.arrayBuffer,
      "the .docx was re-unzipped and re-parsed for a file whose bytes cannot have changed",
    ).toHaveBeenCalledTimes(1);
  });

  it("reads a .txt resume once as well", async () => {
    const resume = countingText("resume.txt", "Alex Shaw\n\nSenior Data Engineer\n");
    expect(await buildTemplateLinesForUpload(resume)).toEqual(["Alex Shaw", "Senior Data Engineer"]);
    expect(await buildTemplateLinesForUpload(resume)).toEqual(["Alex Shaw", "Senior Data Engineer"]);
    expect(resume.text).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent calls for the same file into ONE parse", async () => {
    // The real shape on the chat path: a user hits Send twice quickly, or a
    // download flow asks for the resume and the cover letter in the same tick.
    // A cache that stores only the RESOLVED value still parses N times here.
    const bytes = await docxBytes(RESUME_LINES);
    const resume = countingDocx("resume.docx", bytes);

    const results = await Promise.all([
      buildTemplateLinesForUpload(resume),
      buildTemplateLinesForUpload(resume),
      buildTemplateLinesForUpload(resume),
    ]);

    for (const lines of results) expect(lines).toEqual(RESUME_LINES);
    expect(resume.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("keeps two different files apart", async () => {
    // The degenerate cache -- one slot, or a key that is not the file -- passes
    // every assertion above and fails here by handing back the resume's lines
    // for the cover letter.
    const resume = countingDocx("resume.docx", await docxBytes(RESUME_LINES));
    const coverLetter = countingDocx("cover.docx", await docxBytes(["Dear hiring manager,"]));

    expect(await buildTemplateLinesForUpload(resume)).toEqual(RESUME_LINES);
    expect(await buildTemplateLinesForUpload(coverLetter)).toEqual(["Dear hiring manager,"]);
    expect(await buildTemplateLinesForUpload(resume)).toEqual(RESUME_LINES);
    expect(await buildTemplateLinesForUpload(coverLetter)).toEqual(["Dear hiring manager,"]);

    expect(resume.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(coverLetter.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failure -- a torn read is retried, not remembered", async () => {
    // A `File` whose backing disk file moved throws NotReadableError. Caching
    // that would make one transient read failure permanent for the life of the
    // tab: the user re-picks nothing, retries, and keeps getting an empty
    // resume with no way to clear it.
    const bytes = await docxBytes(RESUME_LINES);
    let attempt = 0;
    const flaky = {
      name: "resume.docx",
      arrayBuffer: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("NotReadableError");
        return bytes;
      }),
    };

    await expect(buildTemplateLinesForUpload(flaky)).rejects.toThrow(/NotReadableError/);
    expect(await buildTemplateLinesForUpload(flaky)).toEqual(RESUME_LINES);
    expect(flaky.arrayBuffer).toHaveBeenCalledTimes(2);
  });
});

describe("[fence] caching must not let one caller corrupt another's lines", () => {
  // Currently green (every call builds a fresh array today) and it must STAY
  // green: the obvious cache -- hand every caller the same array instance --
  // turns this red. `app/hooks/useDocumentPreview.js` and `app/page.js` both
  // take the returned lines into `alignLinesToSlots` / `fitLinesToTemplate`
  // pipelines, and a shared instance is one careless `.push` away from the
  // resume growing a line every time the panel is opened.
  it("hands each caller its own array", async () => {
    const resume = countingDocx("resume.docx", await docxBytes(RESUME_LINES));
    const first = await buildTemplateLinesForUpload(resume);
    first.push("INJECTED");
    first[0] = "MUTATED";

    const second = await buildTemplateLinesForUpload(resume);
    expect(second).toEqual(RESUME_LINES);
    expect(second).not.toBe(first);
  });
});

describe("[fence] a file that is not a resume is still answered, not cached into a wrong shape", () => {
  it("returns [] for an unsupported extension, every time", async () => {
    // `buildTemplateLinesForUpload` answers `[]` for anything that is neither a
    // .docx nor a text resume, and the memo must not turn that into a shared
    // array or a thrown key error. `null` is included because it is not a legal
    // WeakMap key and the guard for it is easy to lose.
    const odd = { name: "photo.png" };
    expect(await buildTemplateLinesForUpload(odd)).toEqual([]);
    expect(await buildTemplateLinesForUpload(odd)).toEqual([]);
    expect(await buildTemplateLinesForUpload(null)).toEqual([]);
    expect(await buildTemplateLinesForUpload(undefined)).toEqual([]);
  });
});
