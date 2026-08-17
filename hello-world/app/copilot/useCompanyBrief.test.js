// @vitest-environment jsdom
//
// AC-T2.5..T2.9. `useCompanyBrief` is the hook behind the live-interview
// company cue: the candidate says "pull up the company" (or presses the
// sidebar button) and this fetches a short research brief for the SELECTED
// posting from the route that already exists.
//
// Why this file renders the real hook instead of testing a pure function:
// every criterion here is about WHETHER AND WHEN A REQUEST IS ISSUED — never
// on mount, never on a posting change, never twice for the same posting, and
// never landing after it has been superseded. That is composition, not logic,
// and this repo has already shipped a defect of exactly this shape (R-166: two
// individually-correct halves wired together wrong, every other test green).
// So the assertions below are almost all against the `fetch` mock, not against
// the hook's return value. See useCopilotDashboard.wiring.test.js, the
// worked example this file follows for the jsdom docblock, the act() flush
// helper and the IS_REACT_ACT_ENVIRONMENT global.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useCompanyBrief } from "./useCompanyBrief.js";

vi.mock("@/app/settings/engine", () => ({
  readEngine: vi.fn(() => "gemini"),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POSTING = {
  id: "app-1",
  title: "Staff Engineer",
  company: "Acme Corp",
  description: "Own the billing platform.",
  label: "Staff Engineer — Acme Corp",
};
const OTHER_POSTING = { ...POSTING, id: "app-2", company: "Globex", title: "Principal Engineer" };

const ARTICLES = [
  {
    id: "art-0",
    title: "Acme raises Series C",
    source: "TechCrunch",
    date: "2026-02-01",
    url: "https://example.com/a",
    summary: "Acme raised $80M.",
    suggestion: "Ask how the raise changes the roadmap.",
  },
];

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, body) {
  return { ok: false, status, json: async () => body };
}

let container;
let root;
let latest;

// A probe that renders nothing and simply publishes the hook's current return
// value, so a test can both read state and CALL the actions it exposes.
function Probe({ posting }) {
  latest = useCompanyBrief(posting);
  return null;
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    // Sequential on purpose: each flush must settle before the next is
    // scheduled, so this is not Promise.all.
    await act(async () => {});
  }
}

async function render(posting) {
  await act(async () => {
    root.render(createElement(Probe, { posting }));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
  globalThis.fetch = vi.fn(async () => okResponse({ articles: ARTICLES, warnings: [] }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useCompanyBrief — nothing is requested until asked (AC-T2.6)", () => {
  it("issues no request on mount, with a posting already selected", async () => {
    await render(POSTING);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(latest.status).toBe("idle");
    expect(latest.open).toBe(false);
  });

  it("issues no request when the posting changes", async () => {
    await render(POSTING);
    await render(OTHER_POSTING);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("issues the request only once openBrief is called", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(latest.open).toBe(true);
  });
});

describe("useCompanyBrief — the request body (AC-T2.8)", () => {
  it("posts the company, job title, posting text and engine to the research route", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/company-research");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      company: "Acme Corp",
      jobTitle: "Staff Engineer",
      posting: "Own the billing platform.",
      engine: "gemini",
    });
  });

  it("issues no request at all when the posting names no company", async () => {
    await render({ ...POSTING, company: "" });
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // The panel still opens and says why, rather than silently doing nothing.
    expect(latest.open).toBe(true);
    expect(latest.status).not.toBe("loading");
  });

  it("issues no request when no posting is selected at all", async () => {
    await render(null);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("useCompanyBrief — results (AC-T2.5)", () => {
  it("exposes the normalized articles and the company they belong to", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();

    expect(latest.status).toBe("done");
    expect(latest.articles).toHaveLength(1);
    expect(latest.articles[0].title).toBe("Acme raises Series C");
    expect(latest.company).toBe("Acme Corp");
    expect(latest.error).toBe("");
  });

  it("drops an article the shared normalizer rejects", async () => {
    // Proves the hook runs its results through lib/copilot/companyBrief.js's
    // normalizeBriefArticles rather than handing the route's raw payload to
    // the render layer. A blank summary is the normalizer's own drop rule.
    globalThis.fetch = vi.fn(async () =>
      okResponse({ articles: [...ARTICLES, { title: "No summary", summary: "  " }], warnings: [] }),
    );
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.articles.map((a) => a.title)).toEqual(["Acme raises Series C"]);
  });

  it("carries the route's warnings through", async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse({ articles: ARTICLES, warnings: ["Could not confirm these via live search."] }),
    );
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.warnings).toEqual(["Could not confirm these via live search."]);
  });

  it("reports done with no articles rather than an error when the search found nothing", async () => {
    globalThis.fetch = vi.fn(async () => okResponse({ articles: [], warnings: [] }));
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("done");
    expect(latest.articles).toEqual([]);
  });
});

describe("useCompanyBrief — failures surface their real reason (AC-T2.8)", () => {
  it("surfaces the route's own 503 message when the key is not configured", async () => {
    globalThis.fetch = vi.fn(async () =>
      errorResponse(503, { error: "Company research needs the Gemini API key to be configured." }),
    );
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("error");
    expect(latest.error).toBe("Company research needs the Gemini API key to be configured.");
  });

  it("surfaces the route's error text on any other non-OK response", async () => {
    globalThis.fetch = vi.fn(async () =>
      errorResponse(502, { error: "No usable articles were found for that company." }),
    );
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("error");
    expect(latest.error).toBe("No usable articles were found for that company.");
  });

  it("surfaces a rejected fetch instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network down");
    });
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("error");
    expect(latest.error).toBe("Network down");
  });

  it("still says something useful when the response body is not JSON", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }));
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("error");
    expect(latest.error.trim().length).toBeGreaterThan(0);
  });
});

describe("useCompanyBrief — reopening and refreshing (AC-T2.7)", () => {
  it("reopening for the same posting costs no second request", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    await act(async () => {
      latest.closeBrief();
    });
    await act(async () => {
      latest.openBrief();
    });
    await flush();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(latest.open).toBe(true);
    expect(latest.articles).toHaveLength(1);
  });

  it("refresh always issues a new request, even with a result already loaded", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    await act(async () => {
      latest.refresh();
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("a failed load can be retried by opening again", async () => {
    globalThis.fetch = vi.fn(async () => errorResponse(502, { error: "nope" }));
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.status).toBe("error");

    globalThis.fetch = vi.fn(async () => okResponse({ articles: ARTICLES, warnings: [] }));
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("done");
  });

  it("changing the posting discards the previous company's result", async () => {
    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(latest.articles).toHaveLength(1);

    await render(OTHER_POSTING);
    expect(latest.articles).toEqual([]);
    expect(latest.status).toBe("idle");

    // ...and opening again for the NEW posting really does go back to the
    // network, rather than serving the old company's brief.
    await act(async () => {
      latest.openBrief();
    });
    await flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body).company).toBe("Globex");
  });
});

describe("useCompanyBrief — a superseded request never lands (AC-T2.9)", () => {
  it("ignores the first response when a second request was issued while it was in flight", async () => {
    // Two deferred responses: the SECOND settles first, then the first. A hook
    // with no generation guard writes the stale one last and the panel ends up
    // showing the losing request's results.
    const deferred = [];
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          deferred.push(resolve);
        }),
    );

    await render(POSTING);
    await act(async () => {
      latest.openBrief();
    });
    await flush(1);
    await act(async () => {
      latest.refresh();
    });
    await flush(1);
    expect(deferred).toHaveLength(2);

    await act(async () => {
      deferred[1](okResponse({ articles: [{ ...ARTICLES[0], title: "SECOND" }], warnings: [] }));
    });
    await flush();
    await act(async () => {
      deferred[0](okResponse({ articles: [{ ...ARTICLES[0], title: "FIRST" }], warnings: [] }));
    });
    await flush();

    expect(latest.articles.map((a) => a.title)).toEqual(["SECOND"]);
  });
});
