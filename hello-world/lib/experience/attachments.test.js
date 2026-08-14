import { describe, it, expect } from "vitest";
import { classifyAttachment, storagePathFor, MAX_SEGMENT } from "./attachments.js";

// Attachment rules for project pages.
//
// Revision 2, after an audit ran 27 mutants against the first draft: 13
// survived, and three of that draft's own "hostile" fixtures turned out to
// assert nothing at all. Two design changes came out of it:
//
//  1. storagePathFor now takes the attachment's ID, so the key is
//     `${userId}/experience/${pageId}/${attachmentId}-${safeName}`. Uniqueness
//     is no longer the sanitizer's problem - the audit found SEVEN inputs (four
//     of them fixtures in the draft) collapsing onto the single key "file", so
//     a real notes.md could be overwritten by anyone's junk-named upload to the
//     same page.
//  2. The pipeline ORDER is specified, because the audit built a variant that
//     passed the whole suite and still emitted "../../other-user/resume.docx" -
//     fullwidth characters that NFKC-fold into separators, with normalization
//     run at the END of the pipeline instead of the start. Required order:
//     NFKC normalize -> percent-decode to exhaustion -> strip forbidden
//     characters -> collapse separators -> strip ".." repeatedly -> trim
//     leading dots and trailing dots/spaces -> truncate.
//
// Hostile characters are BUILT from code points rather than typed. Typing an
// escape for an invisible character is how raw control bytes got into a source
// file in this repo before; git then treats the file as binary and every gate
// still passes.

const file = (name, type, size) => ({ name, type, size });
const MB = 1024 * 1024;

const ZWSP = String.fromCodePoint(0x200b); // zero-width space
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const BOM = String.fromCodePoint(0xfeff);
const C1 = String.fromCodePoint(0x0085); // next-line, a C1 control
const FW_DOT = String.fromCodePoint(0xff0e); // fullwidth full stop, NFKC -> "."
const FW_SLASH = String.fromCodePoint(0xff0f); // fullwidth solidus, NFKC -> "/"
const SQUARE_CO = String.fromCodePoint(0x337f); // NFKC expands one char into four

// Code points no storage key segment may contain, as ranges rather than a
// regex, so this file carries no escape sequences for invisible characters.
const FORBIDDEN = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function forbiddenCharIn(value) {
  for (const ch of value) {
    const c = ch.codePointAt(0);
    if (FORBIDDEN.some(([lo, hi]) => c >= lo && c <= hi)) return ch;
  }
  return null;
}

// D2: normalizeAndDecodeToExhaustion alternates normalize-then-decode for at
// most 15 rounds. Each round's LAST action (when it doesn't converge) is a
// decode, never a normalize — so an input that is still changing on round 15
// is returned exactly as that round's decode left it. Built by repeated
// encodeURIComponent (not typed), so the encoding depth is exact:
//   - 15 layers: the loop's final round decodes down to the raw fullwidth
//     traversal itself, but the cap is hit before that round's own output is
//     normalized again — the fullwidth characters survive un-normalized.
//   - 16 layers: one layer of percent-encoding is still undecoded when the
//     cap hits, so literal "%EF%BC..." escapes survive instead.
// Both were verified against this file's un-patched sanitizeSegment before
// the fix: 15 layers folds (via segment.normalize("NFKC")) to a key
// containing "../../", and 16 layers leaves a literal "%" escape in the
// segment — precisely the two failure modes this pipeline exists to defeat.
function percentEncodeLayers(value, layers) {
  let out = value;
  for (let i = 0; i < layers; i++) out = encodeURIComponent(out);
  return out;
}
const FW_TRAVERSAL = `${FW_DOT}${FW_DOT}${FW_SLASH}${FW_DOT}${FW_DOT}${FW_SLASH}pwn.png`;

describe("classifyAttachment", () => {
  it("recognises each kind from its mime type", () => {
    expect(classifyAttachment(file("shot.png", "image/png", MB))).toEqual({
      kind: "image",
      ok: true,
      reason: "",
    });
    expect(classifyAttachment(file("spec.pdf", "application/pdf", MB)).kind).toBe("pdf");
    expect(classifyAttachment(file("demo.mp4", "video/mp4", MB)).kind).toBe("video");
    expect(classifyAttachment(file("notes.txt", "text/plain", MB)).kind).toBe("text");
  });

  it("falls back to the extension when the browser reports no mime type", () => {
    expect(classifyAttachment(file("shot.PNG", "", MB)).kind).toBe("image");
    expect(classifyAttachment(file("clip.MOV", "", MB)).kind).toBe("video");
    expect(classifyAttachment(file("notes.md", "", MB)).kind).toBe("text");
    expect(classifyAttachment(file("brief.docx", "", MB)).kind).toBe("text");
  });

  it("does not guess a kind for an unknown extension with no mime type", () => {
    // Defaulting the unknown case to "text" would let an arbitrary binary
    // through and then hand it to a model as if it were readable context.
    expect(classifyAttachment(file("setup.exe", "", MB))).toMatchObject({ kind: "other", ok: false });
    expect(classifyAttachment(file("noextension", "", MB))).toMatchObject({ kind: "other", ok: false });
  });

  it("accepts a file exactly ON each cap and rejects one byte more", () => {
    // The boundary itself. Probing only 99 and 101 leaves the comparison
    // operator free, and "up to 100 MB" rejecting a 100 MB file is the bug the
    // user actually hits.
    expect(classifyAttachment(file("edge.mp4", "video/mp4", 100 * MB)).ok).toBe(true);
    expect(classifyAttachment(file("over.mp4", "video/mp4", 100 * MB + 1)).ok).toBe(false);
    expect(classifyAttachment(file("edge.pdf", "application/pdf", 25 * MB)).ok).toBe(true);
    expect(classifyAttachment(file("over.pdf", "application/pdf", 25 * MB + 1)).ok).toBe(false);
  });

  it("names the limit AND the file in the reason, on every path", () => {
    const video = classifyAttachment(file("big.mp4", "video/mp4", 200 * MB));
    expect(video.reason).toContain("100 MB");
    expect(video.reason).toContain("big.mp4");
    // The draft asserted the filename only on the video path, so the identical
    // defect in the other branch survived.
    const doc = classifyAttachment(file("big.pdf", "application/pdf", 200 * MB));
    expect(doc.reason).toContain("25 MB");
    expect(doc.reason).toContain("big.pdf");
  });

  it("keeps reporting the kind of a file it rejects", () => {
    // The UI shows "too large" beside a video icon; losing the kind on
    // rejection turns every failure into an anonymous "other".
    expect(classifyAttachment(file("big.mp4", "video/mp4", 200 * MB)).kind).toBe("video");
    expect(classifyAttachment(file("big.pdf", "application/pdf", 200 * MB)).kind).toBe("pdf");
  });

  it("rejects an unsupported type", () => {
    expect(classifyAttachment(file("setup.exe", "application/octet-stream", MB))).toMatchObject({
      kind: "other",
      ok: false,
    });
  });

  it("rejects a file with no readable size", () => {
    for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null, undefined]) {
      expect(classifyAttachment(file("x.png", "image/png", size)).ok).toBe(false);
    }
  });

  it("never throws on junk input", () => {
    for (const input of [null, undefined, {}, { name: 42, type: [], size: {} }]) {
      expect(() => classifyAttachment(input)).not.toThrow();
      expect(classifyAttachment(input).ok).toBe(false);
    }
  });
});

// A project page is where the work itself lives, and most of that work leaves
// a deck or a spreadsheet behind. Both were rejected outright as `other`
// before this block existed - the user saw "not a supported file type" for the
// two formats a project is most likely to have produced.
//
// They get their own kinds rather than joining `text`: `text` is this file's
// word for "readable as-is", which is precisely what a zip of OOXML parts is
// not. See lib/experience/pageContext.js, whose inventory line for these two
// kinds has to say the contents were never read.
describe("classifyAttachment: PowerPoint and Excel", () => {
  // The mime types a browser actually reports.
  //
  // Every fixture below deliberately carries an extension the module does NOT
  // know (".bin"), so the mime type is the only thing that can decide the
  // kind. An earlier draft of this block named them "deck.pptx", "book.xlsx"
  // and so on - and an audit proved that deleting the ENTIRE mime table left
  // the spreadsheet case green, because `kindOf` fell through to the
  // extension and reached the same answer. Twelve of the fourteen mime
  // strings this block exists to pin were unfalsifiable.
  //
  // The two exceptions keep their real names on purpose: "apple.key" because
  // ".key" is deliberately absent from the extension table (see the private
  // key case below), so the Keynote mime is the only thing that can classify
  // it either way.
  //
  // The macro-enabled types are written in the casing Windows really sends
  // ("macroEnabled"), not folded to lower case first, because kindFromMime
  // lowercases its input before looking anything up - a table keyed on this
  // literal casing would never match, and a fixture that pre-folded the
  // string would hide that.
  const SLIDE_FILES = [
    ["pres.bin", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["theme.bin", "application/vnd.openxmlformats-officedocument.presentationml.template"],
    ["slideshow.bin", "application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
    ["macro-pptm.bin", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
    ["legacy-ppt.bin", "application/vnd.ms-powerpoint"],
    ["opendoc-odp.bin", "application/vnd.oasis.opendocument.presentation"],
    ["apple.key", "application/vnd.apple.keynote"],
  ];

  const SHEET_FILES = [
    ["book.bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["tmpl.bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
    ["macro-xlsm.bin", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    ["macro-xlsb.bin", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
    ["legacy-xls.bin", "application/vnd.ms-excel"],
    ["opendoc-ods.bin", "application/vnd.oasis.opendocument.spreadsheet"],
    ["apple-numbers.bin", "application/vnd.apple.numbers"],
  ];

  it("recognises a slide deck from its mime type", () => {
    for (const [name, type] of SLIDE_FILES) {
      expect(classifyAttachment(file(name, type, MB)), name).toMatchObject({ kind: "slides", ok: true });
    }
  });

  it("recognises a spreadsheet from its mime type", () => {
    for (const [name, type] of SHEET_FILES) {
      expect(classifyAttachment(file(name, type, MB)), name).toMatchObject({ kind: "sheet", ok: true });
    }
  });

  it("falls back to the extension when the browser reports no mime type", () => {
    // Safari and several file managers hand over an empty `type` for OOXML.
    for (const name of ["deck.pptx", "legacy.ppt", "macro.pptm", "theme.potx", "show.ppsx", "show.pps", "open.odp"]) {
      expect(classifyAttachment(file(name, "", MB)), name).toMatchObject({ kind: "slides", ok: true });
    }
    for (const name of ["book.xlsx", "legacy.xls", "macro.xlsm", "binary.xlsb", "tmpl.xltx", "open.ods", "apple.numbers"]) {
      expect(classifyAttachment(file(name, "", MB)), name).toMatchObject({ kind: "sheet", ok: true });
    }
    // Case-insensitively, like every other extension this module knows.
    expect(classifyAttachment(file("DECK.PPTX", "", MB)).kind).toBe("slides");
    expect(classifyAttachment(file("BOOK.XLSX", "", MB)).kind).toBe("sheet");
  });

  it("does not treat a bare .key file as a Keynote deck", () => {
    // "server.key" is a PEM private key far more often than it is a
    // presentation, and this module's own rule is that an unrecognised binary
    // is never waved through - only the unambiguous Keynote MIME type is.
    expect(classifyAttachment(file("server.key", "", MB))).toMatchObject({ kind: "other", ok: false });
    expect(classifyAttachment(file("apple.key", "application/vnd.apple.keynote", MB)).kind).toBe("slides");
  });

  it("keeps a .csv reported as an Excel type a text file", () => {
    // Windows reports application/vnd.ms-excel for .csv whenever Excel is the
    // registered handler, which is the common case. Letting that legacy
    // family type win would relabel every csv upload a spreadsheet - and, per
    // pageContext, tell the model its contents were not read when in fact a
    // csv is exactly the kind of file that IS readable.
    expect(classifyAttachment(file("rows.csv", "application/vnd.ms-excel", MB)).kind).toBe("text");
    // Positive controls: that same legacy type still decides when the
    // extension agrees with it, and when there is no known extension at all.
    // Without these, simply ignoring application/vnd.ms-excel would pass.
    expect(classifyAttachment(file("book.xls", "application/vnd.ms-excel", MB)).kind).toBe("sheet");
    expect(classifyAttachment(file("export.bin", "application/vnd.ms-excel", MB)).kind).toBe("sheet");
  });

  it("still lets an unambiguous mime type override the extension", () => {
    // The csv rule above is deliberately narrow. Flipping precedence
    // wholesale - extension always wins - would misread a real PDF or PNG
    // that happens to arrive under a .txt name, which is the behaviour this
    // module has always had.
    expect(classifyAttachment(file("notes.txt", "application/pdf", MB)).kind).toBe("pdf");
    expect(classifyAttachment(file("frame.txt", "image/png", MB)).kind).toBe("image");
    // And the exception is exactly one mime wide. Its PowerPoint sibling is
    // not misapplied to anything the way vnd.ms-excel is to csv, so it keeps
    // ordinary precedence: a deck served under a .txt name is still a deck.
    // Without this, widening the exception to the whole vnd.ms-* family - a
    // tempting "symmetry" - goes unnoticed.
    expect(classifyAttachment(file("deck.txt", "application/vnd.ms-powerpoint", MB)).kind).toBe("slides");
  });

  it("holds both kinds to the 25 MB cap, inclusively, and still names the kind when it refuses", () => {
    const deckMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const sheetMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(classifyAttachment(file("edge.pptx", deckMime, 25 * MB)).ok).toBe(true);
    expect(classifyAttachment(file("edge.xlsx", sheetMime, 25 * MB)).ok).toBe(true);

    const deck = classifyAttachment(file("big.pptx", deckMime, 25 * MB + 1));
    expect(deck.ok).toBe(false);
    expect(deck.kind).toBe("slides");
    expect(deck.reason).toContain("25 MB");
    expect(deck.reason).toContain("big.pptx");

    const sheet = classifyAttachment(file("big.xlsx", sheetMime, 25 * MB + 1));
    expect(sheet.ok).toBe(false);
    expect(sheet.kind).toBe("sheet");
    expect(sheet.reason).toContain("25 MB");
    expect(sheet.reason).toContain("big.xlsx");
  });

  it("does not accept a file whose extension is a name on Object's prototype", () => {
    // `EXTENSION_KIND[extensionOf(name)]` is a plain-object lookup, so
    // "notes.constructor" resolves through the prototype chain to a FUNCTION,
    // which is truthy, is not the string "other", and therefore sails through
    // the unsupported-type check into an accepted upload with a function as
    // its kind. `.__proto__` does the same and yields an object. Both survive
    // extensionOf's lower-casing, which is what makes them reachable at all.
    for (const name of ["notes.constructor", "payload.__proto__"]) {
      const result = classifyAttachment(file(name, "", MB));
      expect(typeof result.kind, name).toBe("string");
      expect(result, name).toMatchObject({ kind: "other", ok: false });
    }
  });

  it("does not widen the door for anything else", () => {
    // Positive control on the whole block: an implementation that simply
    // stopped rejecting `other` would pass every test above.
    expect(classifyAttachment(file("setup.exe", "application/octet-stream", MB))).toMatchObject({
      kind: "other",
      ok: false,
    });
    expect(classifyAttachment(file("archive.zip", "application/zip", MB))).toMatchObject({
      kind: "other",
      ok: false,
    });
  });
});

describe("storagePathFor", () => {
  const ID = "att-0001";
  const PREFIX = "u1/experience/p1/";

  it("builds a path under the owner's prefix, tagged with the attachment id", () => {
    expect(storagePathFor("u1", "p1", ID, "notes.md")).toBe(`${PREFIX}${ID}-notes.md`);
  });

  it("scopes by user, page and attachment", () => {
    expect(storagePathFor("u2", "p1", ID, "n.md").startsWith("u2/experience/p1/")).toBe(true);
    expect(storagePathFor("u1", "p9", ID, "n.md").startsWith("u1/experience/p9/")).toBe(true);
    expect(storagePathFor("u1", "p1", "att-0002", "n.md")).toContain("att-0002");
  });

  it("refuses an owner, page or attachment id that is not a plain identifier", () => {
    // These come from the session and from database uuids, never from user
    // input - but they are interpolated raw, so if one ever arrives from a URL
    // segment instead, the prefix itself is what escapes.
    for (const bad of ["../u2", "u1/../u2", "u1/", "", null, "a b"]) {
      expect(() => storagePathFor(bad, "p1", ID, "n.md")).toThrow();
      expect(() => storagePathFor("u1", bad, ID, "n.md")).toThrow();
      expect(() => storagePathFor("u1", "p1", bad, "n.md")).toThrow();
    }
  });

  it("holds the safety invariant for every hostile name", () => {
    const hostile = [
      "../../other-user/resume.docx",
      "..\\..\\windows\\system32\\evil.dll",
      "/absolute/path.txt",
      "./././sneaky.png",
      // ".." NOT at the start, where leading-junk cleanup cannot mask it and a
      // single non-recursive strip leaves it intact.
      "q1-report/../../other-user/steal.pdf",
      "reports/2026/../../../../etc/passwd",
      // ".." that re-forms once invisible characters are removed - safe only if
      // stripping happens BEFORE the ".." pass.
      `a${ZWSP}.${ZWSP}.${ZWSP}b-c.txt`,
      // Fullwidth characters that NFKC-fold into "../../" - safe only if
      // normalization happens FIRST. This exact input escaped a variant that
      // passed the entire first draft.
      `${FW_DOT}${FW_DOT}${FW_SLASH}${FW_DOT}${FW_DOT}${FW_SLASH}other-user${FW_SLASH}resume.docx`,
      `${FW_DOT}hidden.txt`,
      "....//....//escape.txt",
      "%2e%2e%2fencoded.txt",
      "%252e%252e%252fdouble.txt",
      "..%5c..%5cwindows.txt",
      `${RLO}gnp.exe`,
      `${BOM}leading-bom.txt`,
      `bad${C1}c1.txt`,
      ".hidden",
      "..",
      ".",
      "",
      "   ",
      "///",
      "\\\\\\",
      "report.pdf.",
      "report.pdf ",
      "NUL",
      "CON.txt",
      "COM1.pdf",
      "a".repeat(500) + ".txt",
      SQUARE_CO.repeat(120),
      "emoji-and-中文.png",
      // Percent-ENCODED fullwidth separators. Normalizing before decoding
      // leaves whatever the decode produces un-normalized, so these survive as
      // U+FF0F and U+FF0E in the key.
      "%EF%BC%8F%EF%BC%8Eevil.txt",
      "%EF%BC%8E%EF%BC%8E%EF%BC%8Fparent.txt",
      // D2: the same fullwidth traversal, wrapped deep enough in percent-
      // encoding that normalizeAndDecodeToExhaustion's 15-round cap is hit
      // before the fixed point is reached. See percentEncodeLayers' own
      // comment for exactly what each depth reproduces.
      percentEncodeLayers(FW_TRAVERSAL, 15),
      percentEncodeLayers(FW_TRAVERSAL, 16),
      // Truncation is the LAST step, so a cut landing exactly on a space or a
      // dot reintroduces the trailing character an earlier trim removed.
      // Sized against the real budget: 120 minus the id and its separator.
      "a".repeat(110) + " " + "b".repeat(30),
      "a".repeat(110) + "." + "b".repeat(30),
    ];

    for (const name of hostile) {
      const path = storagePathFor("u1", "p1", ID, name);
      const segment = path.slice(PREFIX.length);
      const label = JSON.stringify(name);

      expect(path.startsWith(PREFIX), label).toBe(true);
      expect(segment.includes("/"), label).toBe(false);
      expect(segment.includes("\\"), label).toBe(false);
      expect(segment.includes(".."), label).toBe(false);
      // The same three checks against the NFKC form of the OUTPUT. This is the
      // general statement of the fullwidth problem: it is not enough that the
      // key contains no separator today, if a single normalization pass
      // anywhere downstream - a log viewer, an export, a filesystem - would
      // turn it into one. Checking the literal characters only catches the
      // inputs someone thought to list; checking the normalized output catches
      // the class.
      const folded = segment.normalize("NFKC");
      expect(folded.includes("/"), `${label} (NFKC-folded)`).toBe(false);
      expect(folded.includes("\\"), `${label} (NFKC-folded)`).toBe(false);
      expect(folded.includes(".."), `${label} (NFKC-folded)`).toBe(false);
      // No percent-escape may survive. A key that still reads %2e is one
      // downstream decode away from being a traversal again - and the draft's
      // encoded fixtures asserted nothing, because %2e%2e%2f contains no
      // literal separator or dot pair for the other assertions to catch.
      expect(/%[0-9a-fA-F]{2}/.test(segment), label).toBe(false);
      expect(forbiddenCharIn(segment), label).toBeNull();
      expect(segment.length, label).toBeGreaterThan(0);
      // Length is checked AFTER every transform: NFKC can expand one character
      // into four, so truncating before normalizing overflows the cap.
      expect(segment.length, label).toBeLessThanOrEqual(MAX_SEGMENT);
      expect(segment.startsWith(`${ID}-`), label).toBe(true);

      const namePart = segment.slice(ID.length + 1);
      expect(namePart.length, label).toBeGreaterThan(0);
      expect(namePart.startsWith("."), label).toBe(false);
      expect(namePart.endsWith("."), label).toBe(false);
      expect(namePart.endsWith(" "), label).toBe(false);
      // Windows cannot create a file with a reserved device name, so the
      // download is unopenable however safe the key itself is.
      expect(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(namePart), label).toBe(false);
    }
  });

  it("pins the length cap rather than merely bounding it", () => {
    // toBeLessThanOrEqual(120) on its own is satisfied by a cap of 32, or 19.
    expect(MAX_SEGMENT).toBe(120);
    const long = storagePathFor("u1", "p1", ID, "a".repeat(500) + ".txt").slice(PREFIX.length);
    expect(long.length).toBe(120);
    // The extension must survive truncation or the browser cannot open what it
    // downloads. This is the case where preserving it is actually hard, and the
    // draft only ever truncated a 13-character name.
    expect(long.endsWith(".txt")).toBe(true);
  });

  it("keeps the extension and the recognisable part of an ordinary name", () => {
    // Positive control for the invariant loop: a sanitizer returning a constant
    // satisfies every assertion in it.
    const a = storagePathFor("u1", "p1", ID, "report-january.pdf");
    const b = storagePathFor("u1", "p1", ID, "report-february.pdf");
    expect(a).not.toBe(b);
    expect(a).toContain("january");
    expect(a.endsWith(".pdf")).toBe(true);
  });

  it("does not merge names that differ only by case or by script", () => {
    // Lowercasing merges Notes.MD with notes.md; stripping non-ASCII merges
    // every CJK name into its extension. Both passed the first draft.
    const distinct = ["Notes.MD", "notes.md", "中文.png", "日本語.png", "resume.pdf", "RESUME.pdf"];
    const keys = distinct.map((n) => storagePathFor("u1", "p1", ID, n));
    expect(new Set(keys).size).toBe(distinct.length);
  });
});
