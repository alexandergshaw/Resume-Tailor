import { describe, it, expect } from "vitest";
import { parseDocxToModel, modelToLines, linesToModel, renderModelToHtml } from "./docxPreview.js";
import { getDefaultTemplateBuffer } from "@/lib/llm/engines/tailor-lite/defaultTemplate.js";

describe("parseDocxToModel (bundled résumé template)", () => {
  it("captures formatting that matches the document", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    expect(model.paragraphs.length).toBeGreaterThan(10);

    const runs = model.paragraphs.flatMap((p) => p.runs);
    // The header name is centered.
    expect(model.paragraphs.some((p) => p.align === "center")).toBe(true);
    // Section headings are bold.
    expect(runs.some((r) => r.bold)).toBe(true);
    // The three template sizes (half-pt 26/22/16 => 13/11/8 pt).
    const sizes = new Set(runs.map((r) => r.sizePt).filter(Boolean));
    expect(sizes.has(13)).toBe(true);
    expect(sizes.has(8)).toBe(true);
  });

  it("renderModelToHtml carries the formatting into styled HTML", async () => {
    const html = renderModelToHtml(await parseDocxToModel(await getDefaultTemplateBuffer()));
    expect(html).toMatch(/font-weight:700/); // bold headings/name
    expect(html).toMatch(/font-size:13pt/); // name
    expect(html).toMatch(/font-size:8pt/); // contact line
    expect(html).toMatch(/text-align:center/); // centered header
  });

  it("modelToLines returns the section headings in order", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    const lines = modelToLines(model);
    for (const heading of ["Summary", "Education", "Professional Experience", "Skills"]) {
      expect(lines).toContain(heading);
    }
  });
});

describe("linesToModel", () => {
  it("renders plain text lines as left-aligned paragraphs", () => {
    const model = linesToModel(["Alex Shaw", "", "Senior Engineer"]);
    expect(model.paragraphs).toHaveLength(3);
    expect(model.paragraphs[0].runs[0].text).toBe("Alex Shaw");
    expect(model.paragraphs[1].runs).toHaveLength(0); // blank line
    expect(modelToLines(model)).toEqual(["Alex Shaw", "Senior Engineer"]);
  });
});
