import { describe, it, expect } from "vitest";
import { outlineFromPages } from "./deckOutline.js";

// The slide model for "generate a PowerPoint from these pages".
//
// Kept as a pure transform from parsed markdown to an abstract outline, one
// layer above OOXML, for two reasons. It can be asserted without unzipping
// anything, and the rendering layer (which must inherit an uploaded template's
// theme and layouts) can change completely without touching what goes on the
// slides.
//
// It consumes the token tree from lib/experience/markdown.js rather than
// re-parsing. A second markdown parser would drift from the first, and the
// first one is the hardened one.

const page = (title, body, attachments = []) => ({
  page: { id: `p-${title}`, title, body },
  attachments,
});

const kinds = (slides) => slides.map((s) => s.kind);

describe("outlineFromPages", () => {
  it("opens each project with a title slide", () => {
    const slides = outlineFromPages([page("Payments migration", "")]);
    expect(slides[0]).toMatchObject({ kind: "title", title: "Payments migration" });
  });

  it("turns each body heading into its own slide, with the bullets under it", () => {
    const slides = outlineFromPages([
      page("Payments", "## What changed\n\n- Dropped the legacy processor\n- Cut settlement to a day"),
    ]);
    const content = slides.find((s) => s.kind === "content");
    expect(content).toMatchObject({ title: "What changed" });
    expect(content.bullets).toEqual([
      "Dropped the legacy processor",
      "Cut settlement to a day",
    ]);
  });

  it("keeps prose that precedes any heading rather than dropping it", () => {
    // A page whose body opens with a paragraph is the common case. Losing it
    // because no heading had been seen yet would silently omit the summary.
    const slides = outlineFromPages([page("Payments", "We moved billing in-house.\n\n## Later")]);
    const text = JSON.stringify(slides);
    expect(text).toContain("We moved billing in-house.");
  });

  it("carries a code block through as code, not as a bullet", () => {
    const slides = outlineFromPages([page("Payments", "```sql\nselect 1;\n```")]);
    const code = slides.find((s) => s.kind === "code" || (s.blocks || []).some((b) => b.kind === "code"));
    expect(JSON.stringify(slides)).toContain("select 1;");
    expect(code).toBeTruthy();
  });

  it("gives an image attachment its own slide, captioned from its notes", () => {
    const slides = outlineFromPages([
      page("Payments", "", [
        { id: "a1", name: "topology.png", kind: "image", notes: "before the migration" },
      ]),
    ]);
    const image = slides.find((s) => s.kind === "image");
    expect(image).toMatchObject({ attachmentId: "a1", caption: "before the migration" });
  });

  it("falls back to the file name when an image has no notes", () => {
    const slides = outlineFromPages([
      page("Payments", "", [{ id: "a1", name: "topology.png", kind: "image", notes: "" }]),
    ]);
    expect(slides.find((s) => s.kind === "image").caption).toBe("topology.png");
  });

  it("represents a video as a named placeholder instead of dropping it", () => {
    // A generated deck cannot meaningfully embed video. Silently omitting it
    // means the user presents a deck missing something they attached and
    // believed was included - state it on a slide instead.
    const slides = outlineFromPages([
      page("Payments", "", [
        { id: "v1", name: "demo.mp4", kind: "video", notes: "walkthrough of the new flow" },
      ]),
    ]);
    const placeholder = slides.find((s) => s.kind === "videoPlaceholder");
    expect(placeholder).toMatchObject({ attachmentId: "v1" });
    expect(JSON.stringify(placeholder)).toContain("demo.mp4");
    expect(JSON.stringify(placeholder)).toContain("walkthrough of the new flow");
  });

  it("does not invent slides for attachment kinds it cannot show", () => {
    // Positive control for the placeholder rule: it applies to video
    // specifically, not to everything the deck cannot render.
    const slides = outlineFromPages([
      page("Payments", "", [{ id: "d1", name: "spec.pdf", kind: "pdf", notes: "" }]),
    ]);
    expect(kinds(slides)).not.toContain("image");
    expect(kinds(slides)).not.toContain("videoPlaceholder");
  });

  it("keeps several projects in the order given, each starting a new title slide", () => {
    const slides = outlineFromPages([
      page("First", "## A\n\n- one"),
      page("Second", "## B\n\n- two"),
    ]);
    const titles = slides.filter((s) => s.kind === "title").map((s) => s.title);
    expect(titles).toEqual(["First", "Second"]);
    // The second project's title slide must come after the first project's
    // content, not be hoisted into a block of title slides.
    const order = slides.map((s) => s.title);
    expect(order.indexOf("Second")).toBeGreaterThan(order.indexOf("A"));
  });

  it("still produces a usable deck for a page with nothing in it", () => {
    const slides = outlineFromPages([page("Empty project", "")]);
    expect(slides).toHaveLength(1);
    expect(slides[0].kind).toBe("title");
  });

  it("gives an untitled page a stated placeholder rather than an empty slide", () => {
    const slides = outlineFromPages([page("", "")]);
    expect(slides[0].title.trim()).not.toBe("");
  });

  it("returns nothing for no pages, and never throws on junk", () => {
    expect(outlineFromPages([])).toEqual([]);
    for (const input of [null, undefined, [null], [{}], [{ page: null }]]) {
      expect(() => outlineFromPages(input)).not.toThrow();
    }
  });

  it("does not carry attachment bytes or storage paths into the outline", () => {
    // The outline is handed to a renderer and may be logged or serialized;
    // image bytes are fetched at render time by id, not smuggled through here.
    const slides = outlineFromPages([
      page("Payments", "", [
        { id: "a1", name: "x.png", kind: "image", notes: "", dataB64: "SECRETBYTES", storage_path: "u1/secret" },
      ]),
    ]);
    const text = JSON.stringify(slides);
    expect(text).not.toContain("SECRETBYTES");
    expect(text).not.toContain("u1/secret");
  });
});
