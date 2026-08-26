// TDD, written before lib/experience/attachmentText.js exists. These MUST fail
// until it does.
//
// Fixtures are GENERATED here rather than committed, following
// lib/scrape/screenshotOcr.test.js's precedent - a committed binary is a fixture
// nobody can read in a diff or fix in a review.
//
// WHAT THIS MODULE DECIDES, and why the decision is delicate: which attached
// files this app can honestly claim to have read. Every branch that returns text
// is a claim, made to a model, that will be spoken aloud by a candidate in an
// interview. Every branch that returns `unsupported` is the app admitting it
// cannot read a file the user attached. Getting the SECOND kind wrong is worse
// than getting the first kind wrong, because it fails silently and in the
// user's favour-sounding direction.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  extractAttachmentText,
  MAX_EXTRACTED_CHARS,
  MAX_PDF_PARSE_BYTES,
  MAX_DOCX_PARSE_BYTES,
} from "./attachmentText.js";

// A minimal real .docx: the three parts Word requires, zipped. mammoth reads
// word/document.xml, so the paragraph text below is what must come back.
async function makeDocx(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

const utf8 = (s) => new TextEncoder().encode(s);

describe("extractAttachmentText", () => {
  describe("plain text files", () => {
    it("decodes an allow-listed text extension", async () => {
      const result = await extractAttachmentText({
        bytes: utf8("Sharded the ledger by tenant id.\nCut p99 from 800ms to 90ms."),
        kind: "text",
        name: "notes.txt",
      });
      expect(result.status).toBe("ok");
      expect(result.text).toContain("Sharded the ledger by tenant id.");
      expect(result.text).toContain("Cut p99 from 800ms to 90ms.");
    });

    it.each(["notes.md", "notes.markdown", "rows.csv", "payload.json", "server.log"])(
      "decodes %s",
      async (name) => {
        const result = await extractAttachmentText({ bytes: utf8("ledger settlement"), kind: "text", name });
        expect(result.status).toBe("ok");
        expect(result.text).toContain("ledger settlement");
      },
    );

    it("reports an EMPTY file as empty, never as ok-with-nothing and never as failed", async () => {
      // Three states the honesty apparatus has to tell apart, and this is the
      // boundary between two of them. "We read it and there was nothing in it"
      // and "we could not read it" produce different sentences to the user.
      const result = await extractAttachmentText({ bytes: utf8("   \n\n  "), kind: "text", name: "empty.txt" });
      expect(result.status).toBe("empty");
      expect(result.text).toBe("");
    });
  });

  describe("bytes arrive in more than one JS wrapper shape", () => {
    // THE BUG THIS PINS. normalizeBytes used to accept ONLY `instanceof
    // Uint8Array` and silently returned a ZERO-LENGTH Uint8Array for
    // anything else — including a plain ArrayBuffer, which is exactly what
    // `await file.arrayBuffer()` returns, wave 2's own documented way of
    // reading an uploaded file's bytes into memory. Every branch in this
    // module treats zero bytes as a legitimately empty file, so an
    // ArrayBuffer input silently became `status: "empty"` — "we read your
    // file and it had nothing in it" — for a file this module never
    // actually looked at. That is this module's own documented worst
    // failure mode: wrong, and wrong in the user's favour-sounding
    // direction.
    const content = "Sharded the ledger by tenant id.";

    it("reads an ArrayBuffer the same way it reads a Uint8Array", async () => {
      const arrayBuffer = utf8(content).buffer;
      const result = await extractAttachmentText({ bytes: arrayBuffer, kind: "text", name: "notes.txt" });
      expect(result.status).toBe("ok");
      expect(result.text).toContain(content);
    });

    it("reads a Node Buffer (a Uint8Array subclass) the same way", async () => {
      const buffer = Buffer.from(content, "utf-8");
      const result = await extractAttachmentText({ bytes: buffer, kind: "text", name: "notes.txt" });
      expect(result.status).toBe("ok");
      expect(result.text).toContain(content);
    });

    it("reads a DataView over an ArrayBuffer, not just a byte-typed array", async () => {
      // A DataView is an ArrayBufferView but NOT a Uint8Array, so this also
      // pins that the fix reads a view's own buffer/byteOffset/byteLength
      // rather than only recognising Uint8Array specifically.
      const bytes = utf8(content);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const result = await extractAttachmentText({ bytes: view, kind: "text", name: "notes.txt" });
      expect(result.status).toBe("ok");
      expect(result.text).toContain(content);
    });

    it("reports genuinely unusable bytes as failed, never as empty", async () => {
      // The other half of the fix: something that is not byte-shaped at all
      // (not a Uint8Array, ArrayBuffer, or any other ArrayBufferView) must
      // not be silently treated as a zero-length, legitimately empty file —
      // that is exactly the confusion this test suite exists to keep apart
      // (see "reports an EMPTY file as empty" above).
      const result = await extractAttachmentText({ bytes: { length: 5 }, kind: "text", name: "notes.txt" });
      expect(result.status).toBe("failed");
      expect(result.text).toBe("");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe("the allow-list is an allow-list, not a fallback", () => {
    it("refuses .rtf even though it is classified as the text kind", async () => {
      // THE TRAP THIS PINS. lib/experience/attachments.js maps .rtf (and
      // application/rtf) to kind "text", and an RTF file IS mostly readable
      // ASCII - so a naive "kind is text, therefore decode it" implementation
      // returns `{\rtf1\ansi\deff0{\fonttbl...` and presents that to the model
      // as the user's own writing. It looks like it worked. It is control-word
      // soup with the real sentences buried in it.
      const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}\f0\fs24 I led the payments migration.\par}`;
      const result = await extractAttachmentText({ bytes: utf8(rtf), kind: "text", name: "resume.rtf" });
      expect(result.status).toBe("unsupported");
      expect(result.text).toBe("");
      // Positive control on the negative claim: the soup specifically must not
      // be what came back. Without this, `text: ""` alone would also be
      // produced by a module that returned "" for everything.
      expect(result.text).not.toContain("rtf1");
    });

    it.each(["old.doc", "notes.odt", "notes.pages"])(
      "refuses %s, which mammoth cannot read",
      async (name) => {
        const result = await extractAttachmentText({ bytes: utf8("anything"), kind: "text", name });
        expect(result.status).toBe("unsupported");
        expect(result.text).toBe("");
      },
    );

    it("has DEFINED behaviour for a text-kind file whose extension is in no list", async () => {
      // kindFromMime returns "text" for ANY text/* mime, so report.html,
      // data.yaml and an extensionless README all arrive here as kind "text"
      // with an extension the allow-list has never heard of. The first draft of
      // this module defined no behaviour for that case at all, which is how a
      // `default:` nobody asserts gets written.
      for (const name of ["report.html", "data.yaml", "README"]) {
        const result = await extractAttachmentText({ bytes: utf8("hello"), kind: "text", name });
        expect(["ok", "unsupported"]).toContain(result.status);
        if (result.status === "unsupported") expect(result.text).toBe("");
      }
    });
  });

  describe("docx", () => {
    it("extracts paragraph text from a real .docx", async () => {
      const bytes = await makeDocx(["Payments platform", "Sharded the ledger by tenant id."]);
      const result = await extractAttachmentText({ bytes, kind: "text", name: "design.docx" });
      expect(result.status).toBe("ok");
      expect(result.text).toContain("Payments platform");
      expect(result.text).toContain("Sharded the ledger by tenant id.");
    });

    it("reports a corrupt .docx as failed, and does not throw", async () => {
      // `failed`, not `unsupported`: the kind IS supported, this particular
      // file could not be read. The user-facing sentences differ ("couldn't
      // read this file" + retry, vs "can't read this kind of file" + no retry).
      const result = await extractAttachmentText({
        bytes: utf8("this is not a zip at all"),
        kind: "text",
        name: "design.docx",
      });
      expect(result.status).toBe("failed");
      expect(result.text).toBe("");
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe("pdf", () => {
    it("reports a corrupt PDF as failed rather than throwing", async () => {
      const result = await extractAttachmentText({
        bytes: utf8("%PDF-1.4 and then nothing valid at all"),
        kind: "pdf",
        name: "design.pdf",
      });
      expect(result.status).toBe("failed");
      expect(result.text).toBe("");
    });

    it("reports a PDF with no text layer as empty, not as failed", async () => {
      // The single most common real PDF: a scan. Calling it `failed` sends the
      // user chasing a broken file; calling it `ok` tells the model it read the
      // document and found nothing, so it answers "your design doc doesn't
      // cover that". Neither is true. This case needs its own status and the
      // implementer must find a fixture that produces it.
      const result = await extractAttachmentText({
        bytes: await makeScannedLikePdf(),
        kind: "pdf",
        name: "scan.pdf",
      });
      expect(result.status).toBe("empty");
      expect(result.text).toBe("");
    });

    it("extracts real text from a PDF that HAS a text layer", async () => {
      // THE MISSING TEST THIS PINS. Every other PDF test in this describe
      // block feeds a PDF with no usable text: a corrupt one (`failed`) or
      // one with a page but no text-drawing operators (`empty`). Nothing
      // here exercised the actual happy path — before this test, the PDF
      // branch could be mutated to return `empty` for every successful read,
      // or have `mergePages` flipped to `false`, or have the `{ text }`
      // destructure dropped entirely, and this whole file would still pass
      // 43/43.
      const result = await extractAttachmentText({
        bytes: makeTextPdf("Sharded the ledger by tenant id"),
        kind: "pdf",
        name: "design.pdf",
      });
      expect(result.status).toBe("ok");
      expect(result.text).toContain("Sharded the ledger by tenant id");
    });

    it("returns a STRING for mergePages: true, not unpdf's per-page array shape", async () => {
      // Pins the SHAPE this module depends on, not just its content. unpdf's
      // extractText returns an ARRAY of per-page strings unless
      // `mergePages: true` collapses it into ONE string (verified directly
      // against unpdf@1.8.1's own source — see extractFromPdf's own
      // comment). If a future unpdf upgrade ever changed that default, or
      // this module's own `mergePages: true` option were ever dropped,
      // `finishFromDecoded` would receive an array instead of a string;
      // `typeof decoded === "string"` fails, `safe` falls back to `""`, and
      // the result silently becomes `empty` for every PDF this module ever
      // reads — a dependency bump turning into a silent, whole-feature
      // no-op rather than a red test.
      const result = await extractAttachmentText({
        bytes: makeTextPdf("type pin"),
        kind: "pdf",
        name: "design.pdf",
      });
      expect(typeof result.text).toBe("string");
      expect(result.status).toBe("ok");
    });
  });

  describe("kinds that are out of scope", () => {
    it.each(["image", "video", "slides", "sheet", "archive", "other"])(
      "reports %s as unsupported without reading it",
      async (kind) => {
        const result = await extractAttachmentText({ bytes: utf8("anything"), kind, name: `file.${kind}` });
        expect(result.status).toBe("unsupported");
        expect(result.text).toBe("");
      },
    );
  });

  describe("size", () => {
    it("caps the stored text and reports the PRE-CAP length in chars", async () => {
      // `chars` is what makes truncation observable: chars > text.length means
      // the file was longer than what was kept. A boolean would have said only
      // that something was dropped, not how much.
      const oversize = "x".repeat(MAX_EXTRACTED_CHARS + 5000);
      const result = await extractAttachmentText({ bytes: utf8(oversize), kind: "text", name: "big.log" });
      expect(result.status).toBe("ok");
      expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_CHARS);
      expect(result.chars).toBeGreaterThan(result.text.length);
    });

    it("does not decode an enormous file in full before capping it", async () => {
      // The default upload cap is 25 MB. Decoding all of it into a serverless
      // function's heap to then keep 20,000 characters is how a route dies of
      // memory on a file that was accepted at upload. The read is bounded, not
      // just the write.
      //
      // THE GAP THIS CLOSES. The original version of this test asserted only
      // `text.length <= MAX_EXTRACTED_CHARS` — a property CAPPING THE OUTPUT
      // ALONE already guarantees, whether or not the READ itself was ever
      // bounded. Deleting MAX_TEXT_READ_BYTES outright (decode the full 8 MB,
      // then slice the resulting string down to MAX_EXTRACTED_CHARS) would
      // satisfy that one assertion just as well as the real, bounded-read
      // implementation — defeating the point of a test named for the READ.
      // `chars` (the PRE-CAP length of what THIS read actually decoded) is
      // the signal that tells the two apart: this file is entirely
      // single-byte ASCII, so one byte decodes to one character, and a
      // properly bounded read of the first MAX_TEXT_READ_BYTES bytes
      // (MAX_EXTRACTED_CHARS * 4 — this module's own documented formula for
      // that constant) decodes to EXACTLY that many characters, not the
      // file's full 8,388,608.
      const huge = new Uint8Array(8 * 1024 * 1024).fill(0x61); // 8 MB of "a"
      const result = await extractAttachmentText({ bytes: huge, kind: "text", name: "huge.log" });
      expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_CHARS);
      expect(result.chars).toBe(MAX_EXTRACTED_CHARS * 4);
    });

    it("reports too_large for a PDF over its own parse ceiling, and never attempts to parse it", async () => {
      // NO TEST ANYWHERE IN THIS FILE exercised `too_large` at all before
      // this one — the ceiling could be raised to 15 GB, or the whole
      // `too_large` branch deleted outright and every check falling through
      // to a parse attempt, and every other test in this suite would still
      // pass. Content is meaningless bytes: the file must never get far
      // enough to be parsed, corrupt or not.
      const oversized = new Uint8Array(MAX_PDF_PARSE_BYTES + 1).fill(0x25); // '%'
      const result = await extractAttachmentText({ bytes: oversized, kind: "pdf", name: "huge.pdf" });
      expect(result.status).toBe("too_large");
      expect(result.text).toBe("");
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it("does NOT report too_large for a PDF at exactly its own parse ceiling", async () => {
      // The boundary the ceiling actually draws: AT the limit is still
      // attempted (and fails here only because the content is not a real
      // PDF), one byte OVER is refused outright without an attempt.
      const atLimit = new Uint8Array(MAX_PDF_PARSE_BYTES).fill(0x25);
      const result = await extractAttachmentText({ bytes: atLimit, kind: "pdf", name: "at-limit.pdf" });
      expect(result.status).not.toBe("too_large");
    });

    it("gives docx its OWN, higher parse ceiling than PDF's", async () => {
      // THE FIX THIS PINS (item 8). docx used to share PDF's 15 MB ceiling,
      // even though a .docx's size is dominated by embedded media, not by
      // the text mammoth actually extracts — a 16 MB .docx can hold a few
      // KB of real prose and mammoth reads it in milliseconds regardless of
      // how many embedded images pad the file out. Sharing PDF's ceiling
      // meant a 16-25 MB .docx (a file the app's own 25 MB upload cap had
      // ALREADY ACCEPTED) hit `too_large` — and `too_large` is terminal with
      // no retry, so the user was told, forever, that a file the app could
      // have read in milliseconds could not be read at all.
      //
      // MAX_PDF_PARSE_BYTES < 16 MB < MAX_DOCX_PARSE_BYTES: this byte count
      // must never be `too_large` for a docx, even though it certainly would
      // be for a PDF.
      const sixteenMb = new Uint8Array(16 * 1024 * 1024).fill(0x61);
      expect(sixteenMb.length).toBeGreaterThan(MAX_PDF_PARSE_BYTES);
      expect(sixteenMb.length).toBeLessThan(MAX_DOCX_PARSE_BYTES);
      const result = await extractAttachmentText({ bytes: sixteenMb, kind: "text", name: "big.docx" });
      // Not a real zip, so it cannot succeed as `ok` — but once size stops
      // binding, `failed` (unreadable bytes) is the only status left, never
      // `too_large`.
      expect(result.status).not.toBe("too_large");
    });

    it("still reports too_large for a docx over its OWN (higher) ceiling", async () => {
      const oversizedDocx = new Uint8Array(MAX_DOCX_PARSE_BYTES + 1).fill(0x61);
      const result = await extractAttachmentText({ bytes: oversizedDocx, kind: "text", name: "huge.docx" });
      expect(result.status).toBe("too_large");
      expect(result.text).toBe("");
    });
  });

  it("never throws, whatever it is handed", async () => {
    // It runs inside an upload request and inside a backfill loop over a whole
    // library. A throw in either becomes a failed upload or a stalled batch.
    const inputs = [
      undefined,
      {},
      { bytes: null, kind: "text", name: "a.txt" },
      { bytes: utf8("x"), kind: null, name: null },
      { bytes: utf8("x"), kind: "text" },
      { bytes: new Uint8Array(0), kind: "pdf", name: "a.pdf" },
    ];
    for (const input of inputs) {
      await expect(extractAttachmentText(input)).resolves.toBeTruthy();
      const result = await extractAttachmentText(input);
      expect(typeof result.status).toBe("string");
      expect(typeof result.text).toBe("string");
    }
  });
});

// A PDF with a page but no text-drawing operators. The implementer may replace
// this with any fixture that genuinely produces an empty text layer - what the
// test pins is the STATUS, not how the fixture is built.
async function makeScannedLikePdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return utf8(pdf);
}

// A minimal real PDF with an actual text-drawing operator (`Tj`) on its one
// page, so unpdf's text layer is genuinely non-empty — the fixture
// makeScannedLikePdf (above) deliberately omits this to produce `empty`;
// this one exists to produce `ok`. No test anywhere in this file exercised
// the PDF happy path before this fixture was added — see the tests that use
// it for what that gap let slip through unnoticed.
function makeTextPdf(message) {
  const content = `BT /F1 24 Tf 72 700 Td (${message}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return utf8(pdf);
}
