import { describe, it, expect } from "vitest";
import { buildPageContext, MAX_CONTEXT_CHARS } from "./pageContext.js";

// What "Ask AI" pins when you press it on a project page.
//
// The chat route caps pinned context (MAX_RESUME_CHARS, 12000) and silently
// truncates anything longer with an ellipsis. Silently is the problem: a model
// answering from a body that was cut mid-sentence gives a confident answer
// about half a project, and neither the user nor the model knows. So this
// module owns the budget, spends it deliberately, and SAYS when something was
// left out.
//
// It also decides what an attachment contributes. Video bytes are never sent as
// model context, so for a video the notes and any cached transcript are the
// only things the model will ever know about it - which is exactly why they
// must be here and must be labelled as such.

const page = (over = {}) => ({
  id: "p1",
  title: "Payments migration",
  body: "We moved billing off the legacy processor.",
  ...over,
});

const attachment = (over = {}) => ({
  id: "a1",
  name: "topology.png",
  kind: "image",
  bytes: 2048,
  notes: "",
  transcript: "",
  ...over,
});

// The single inventory line an attachment contributes, picked out of the
// assembled context by file name. Asserting on one line rather than on the
// whole string is what lets a test say "this kind's line changed and no
// other's did".
function lineFor(content, name) {
  return content.split("\n").find((line) => line.includes(name)) || "";
}

describe("buildPageContext", () => {
  it("labels the pin with the page title", () => {
    expect(buildPageContext({ page: page() }).label).toContain("Payments migration");
  });

  it("includes the body, the breadcrumb and the child pages", () => {
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: ["Work", "Platform", "Payments migration"],
      childPages: [{ id: "c1", title: "Rollout plan" }],
    });
    expect(content).toContain("We moved billing off the legacy processor.");
    expect(content).toContain("Work / Platform / Payments migration");
    expect(content).toContain("Rollout plan");
  });

  it("lists each attachment with its kind and the user's notes", () => {
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "a2", name: "spec.pdf", kind: "pdf", notes: "" }),
      ],
    });
    expect(content).toContain("topology.png");
    expect(content).toContain("before the migration");
    expect(content).toContain("spec.pdf");
  });

  it("gives a video its notes and transcript, and says so when it has neither", () => {
    // For a video these two strings are the ONLY thing the model ever learns
    // about it - the bytes are not sent. A video listed with nothing attached
    // must not read as though the model watched it.
    const withText = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "v1", name: "demo.mp4", kind: "video", notes: "walkthrough", transcript: "first we log in" }),
      ],
    }).content;
    expect(withText).toContain("walkthrough");
    expect(withText).toContain("first we log in");

    const without = buildPageContext({
      page: page(),
      attachments: [attachment({ id: "v2", name: "silent.mp4", kind: "video", notes: "", transcript: "" })],
    }).content;
    expect(without).toContain("silent.mp4");
    expect(without.toLowerCase()).toMatch(/no transcript|not transcribed|no notes/);
  });

  it("names a deck and a spreadsheet by what they are", () => {
    // The parenthesised kind is what tells the model a .pptx is a deck rather
    // than a stray binary. Pinned by position (startsWith), not by
    // toContain: "slide deck" appearing anywhere on the line is also
    // satisfied by a sentence further along it, which leaves the label itself
    // free to be wrong.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "d1", name: "kickoff.pptx", kind: "slides", notes: "the launch deck" }),
        attachment({ id: "s1", name: "q3.xlsx", kind: "sheet", notes: "" }),
      ],
    });

    expect(lineFor(content, "kickoff.pptx")).toBe(
      "- kickoff.pptx (slide deck) - contents not read - notes: the launch deck",
    );
    expect(lineFor(content, "q3.xlsx")).toBe("- q3.xlsx (spreadsheet) - contents not read");
  });

  it("says 'not read' about the files the model really did not get, and not about the ones it did", () => {
    // This is a claim about the model's actual input, so it has to track what
    // is actually sent. Pressing Ask AI does two things in one handler
    // (app/components/experience/ExperienceTab.js): it pins this context, and
    // then it DOWNLOADS every attachment whose kind is in
    // DOWNLOADABLE_ATTACHMENT_KINDS - image, pdf, text - and hands the bytes
    // to addChatAttachments, which turns them into inline data and extracted
    // text on the same turn. So for those three the model does read the file.
    //
    // A deck or a spreadsheet is downloaded by nothing: OOXML is a zip of XML
    // that no path here parses. Their name and the user's notes are the whole
    // of what the model ever learns, which is exactly why the line has to say
    // so - "- q3.xlsx (spreadsheet)" on its own reads as though the numbers
    // are available, and that is how a model ends up quoting a figure nobody
    // supplied.
    //
    // An earlier draft of this test put the disclaimer on the whole
    // inventory. That was wrong in the more dangerous direction: it told the
    // model it had not read three files it was being handed in the same
    // request.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "d1", name: "kickoff.pptx", kind: "slides" }),
        attachment({ id: "s1", name: "q3.xlsx", kind: "sheet" }),
        attachment({ id: "i1", name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "p1", name: "spec.pdf", kind: "pdf" }),
        attachment({ id: "t1", name: "rows.csv", kind: "text" }),
      ],
    });

    expect(lineFor(content, "kickoff.pptx").toLowerCase()).toMatch(/not read/);
    expect(lineFor(content, "q3.xlsx").toLowerCase()).toMatch(/not read/);
    // The three kinds Ask AI actually uploads must not carry it.
    expect(lineFor(content, "topology.png").toLowerCase()).not.toMatch(/not read/);
    expect(lineFor(content, "spec.pdf").toLowerCase()).not.toMatch(/not read/);
    expect(lineFor(content, "rows.csv").toLowerCase()).not.toMatch(/not read/);
    // And nothing above the list claims it on everything's behalf.
    expect(content.split("\n")[0].toLowerCase()).not.toMatch(/not read/);

    // Positive control: a page with no attachments at all says nothing about
    // reading anything. Without it, hard-coding the phrase somewhere fixed
    // would satisfy the two assertions above.
    expect(buildPageContext({ page: page() }).content.toLowerCase()).not.toMatch(/not read/);
  });

  it("leaves the lines for every other kind exactly as they were", () => {
    // Positive control for the test above: stamping "contents not read" onto
    // every attachment line would satisfy it while quietly changing what the
    // model is told about an image or a PDF. Frozen literals, not a
    // toContain - the shape of these lines is the thing being pinned.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "i1", name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "p1", name: "spec.pdf", kind: "pdf", notes: "" }),
        attachment({ id: "t1", name: "rows.csv", kind: "text", notes: "" }),
      ],
    });
    expect(lineFor(content, "topology.png")).toBe("- topology.png (image) - notes: before the migration");
    expect(lineFor(content, "spec.pdf")).toBe("- spec.pdf (PDF)");
    expect(lineFor(content, "rows.csv")).toBe("- rows.csv (text file)");
  });

  it("never includes attachment bytes or storage paths", () => {
    // The pinned context is sent to a third-party model and logged. An image's
    // bytes would be pure cost and a storage path is an internal detail.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ dataB64: "SECRETBYTES", storage_path: "u1/experience/p1/a1-topology.png", url: "https://signed.example/x" }),
      ],
    });
    expect(content).not.toContain("SECRETBYTES");
    expect(content).not.toContain("u1/experience");
    expect(content).not.toContain("signed.example");
  });

  it("stays within the budget and says what it dropped", () => {
    // Not merely "is shorter than the cap" - a truncation the reader cannot see
    // is the actual defect. Assert the notice, or an implementation that
    // silently slices passes.
    const { content, truncated } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
    });
    expect(content.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(truncated).toBe(true);
    expect(content.toLowerCase()).toMatch(/truncat|shortened|not included/);
  });

  it("reports nothing truncated when everything fits", () => {
    // Positive control: an implementation that always claims truncation would
    // pass the test above.
    const { content, truncated } = buildPageContext({ page: page() });
    expect(truncated).toBe(false);
    expect(content.toLowerCase()).not.toMatch(/truncat/);
  });

  it("keeps the title and breadcrumb even when the body must be cut", () => {
    // Spending the whole budget on the body and losing the page's identity
    // makes the model answer about text with no idea what project it is.
    const { content } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      breadcrumb: ["Work", "Payments migration"],
    });
    expect(content).toContain("Payments migration");
    expect(content).toContain("Work / Payments migration");
  });

  it("keeps the attachment inventory even when the body must be cut", () => {
    // The inventory is small and disproportionately useful - it is how the
    // model knows a video exists at all. Losing it to a long body means the
    // model cannot mention files the user can plainly see on the page.
    const { content } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      attachments: [attachment({ name: "topology.png", notes: "the diagram" })],
    });
    expect(content).toContain("topology.png");
  });

  it("produces something usable for an empty page", () => {
    const { content, label } = buildPageContext({ page: { id: "p9", title: "", body: "" } });
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
    expect(typeof content).toBe("string");
  });

  it("never throws on junk input", () => {
    for (const input of [
      {},
      { page: null },
      { page: page(), attachments: null },
      { page: page(), attachments: [null, {}] },
      { page: page(), breadcrumb: null, childPages: null },
    ]) {
      expect(() => buildPageContext(input)).not.toThrow();
    }
  });
});

// A zip is an opaque blob to every path in this repo - nothing unzips one, and
// its bytes are never handed to the model. So it belongs with slides and
// spreadsheets on the "contents not read" side of the per-line rule, NOT with
// image/pdf/text, whose bytes really are sent in the same request.
//
// Getting this wrong is not cosmetic: it would tell the model a zip's contents
// were provided when nothing read them, which is precisely the claim this file
// exists to keep honest.
describe("a zip attachment is inventory only", () => {
  const zip = { name: "project-export.zip", kind: "archive", notes: "", transcript: "" };

  it("says its contents were not read", () => {
    const { content } = buildPageContext({ page: page(), breadcrumb: [], childPages: [], attachments: [zip] });
    expect(content).toContain("project-export.zip");
    expect(content).toContain("contents not read");
  });

  it("keeps the notes when there are some, still disclaimed", () => {
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: [],
      childPages: [],
      attachments: [{ ...zip, notes: "Full source drop for the migration" }],
    });
    expect(content).toContain("contents not read");
    expect(content).toContain("Full source drop for the migration");
  });

  it("does NOT disclaim a pdf alongside it", () => {
    // Positive control: a blanket disclaimer applied to everything would pass
    // both tests above and would lie about the pdf, whose bytes ExperienceTab
    // downloads and attaches to the very same request.
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: [],
      childPages: [],
      attachments: [zip, { name: "spec.pdf", kind: "pdf", notes: "", transcript: "" }],
    });
    const pdfLine = content.split("\n").find((l) => l.includes("spec.pdf"));
    expect(pdfLine).toBeDefined();
    expect(pdfLine).not.toContain("contents not read");
  });

  it("names the kind in words rather than leaving it a generic file", () => {
    const { content } = buildPageContext({ page: page(), breadcrumb: [], childPages: [], attachments: [zip] });
    const line = content.split("\n").find((l) => l.includes("project-export.zip"));
    expect(line).toContain("archive");
  });
});
