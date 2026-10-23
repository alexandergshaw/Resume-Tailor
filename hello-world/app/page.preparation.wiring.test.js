// Static production wiring instrument; mounted workbench coverage is separate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./page.js", import.meta.url), "utf8");
describe("N176 production sibling navigation", () => {
  it("canary: sees existing Copilot tab and render", () => {
    expect(source).toMatch(/value:\s*["']copilot["'],\s*label:\s*["']Interview Copilot["']/);
    expect(source).toMatch(/mainTab\s*===\s*["']copilot["']/);
  });
  it("makes Preparation a visible sibling and restores its saved tab", () => {
    expect(source).toMatch(/value:\s*["']preparation["'],\s*label:\s*["']Interview Preparation["']/);
    expect(source).toMatch(/savedTab\s*===\s*["']preparation["']/);
  });
  it("renders the actual workbench through existing navigation with account scope", () => {
    expect(source).toMatch(/mainTab\s*===\s*["']preparation["'][\s\S]{0,400}<InterviewPreparation\b/);
    expect(source).toMatch(/<InterviewPreparation\b[\s\S]{0,400}userId=\{/);
    expect(source).toMatch(/onChange=\{[^}]*nav\.goMainTab/);
  });
});

it("passes the real shared strength and Materials navigation into Preparation",()=>{
 expect(source).toMatch(/<InterviewPreparation\b[\s\S]{0,600}aggressiveness=\{aggressiveness\}/);expect(source).toMatch(/<InterviewPreparation\b[\s\S]{0,600}tailorMode=\{tailorMode\}/);expect(source).toMatch(/onChangeStrength=\{[\s\S]{0,300}nav\.goMainTab\(["']applying["']\)/);
});
