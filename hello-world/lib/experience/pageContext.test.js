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
