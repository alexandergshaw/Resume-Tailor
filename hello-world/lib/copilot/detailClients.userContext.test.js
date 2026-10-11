// N155 — each client sends exactly ONE explicit `userContext` field, default "",
// never via a spread (AC4). Parametrised across the three fetch clients.
//
// RED on HEAD, on the assertion: each client EXISTS and lists its fields explicitly
// but carries no userContext field, so the POSTed body has `userContext === undefined`
// and the `=== ""` / `=== value` expectations fail.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fetchExpansion } from "./expansionClient.js";
import { fetchTechTermDetail } from "./techTermDetailClient.js";
import { fetchProjectBulletDetail } from "./projectBulletDetailClient.js";

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const codeOf = (name) => stripComments(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"));

const FAMILIES = [
  {
    name: "fetchExpansion",
    fn: fetchExpansion,
    file: "expansionClient.js",
    url: "/api/copilot/answer/expand",
    req: { question: "q", parentPoint: "p", points: ["p"], pointIndex: 0, applicationId: "a", profile: "", interviewType: "", codeLanguage: "", engine: "" },
  },
  {
    name: "fetchTechTermDetail",
    fn: fetchTechTermDetail,
    file: "techTermDetailClient.js",
    url: "/api/copilot/answer/tech-term-detail",
    req: { term: "t", question: "q", applicationId: "a", engine: "" },
  },
  {
    name: "fetchProjectBulletDetail",
    fn: fetchProjectBulletDetail,
    file: "projectBulletDetailClient.js",
    url: "/api/copilot/answer/project-bullet-detail",
    req: { bullet: "b", title: "t", siblingBullets: [], bulletIndex: 0, question: "q", applicationId: "a", engine: "" },
  },
];

function stubFetch() {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ subBullets: [], detail: "", empty: true, caption: "" }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(FAMILIES)("$name — one explicit userContext field (AC4)", (fam) => {
  it("sends the supplied userContext verbatim in the POST body", async () => {
    const fetchMock = stubFetch();
    await fam.fn({ ...fam.req, userContext: "focus on the trade-offs" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(fam.url);
    const sent = JSON.parse(init.body);
    expect(sent.userContext).toBe("focus on the trade-offs");
  });

  it("defaults userContext to '' when the request omits it (always present, never undefined)", async () => {
    const fetchMock = stubFetch();
    await fam.fn({ ...fam.req });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toHaveProperty("userContext");
    expect(sent.userContext).toBe("");
  });

  it("[guard] still explicit, never a spread: an unknown field does not travel", async () => {
    const fetchMock = stubFetch();
    await fam.fn({ ...fam.req, userContext: "x", secretExtra: "SHOULD NOT TRAVEL" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.secretExtra).toBeUndefined();
  });

  it("[diff-check] the payload literal names userContext explicitly and spreads no request object", () => {
    const code = codeOf(fam.file);
    expect(code).toMatch(/userContext:\s*request\?\.userContext\s*\?\?\s*""/);
    expect(code).not.toMatch(/\.\.\.request\b/);
  });
});
