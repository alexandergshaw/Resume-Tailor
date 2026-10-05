// N107 go-live (VF-1) -- the SERVER kill-switch on the Ideal branch.
//
// At N105 slice-1 the dark-launch gate is CLIENT-ONLY: app/api/tailor/route.js
// sets `idealRun` straight from formData.tailorMode and never consults
// idealLevelEnabled(), so a crafted authenticated POST can invoke the
// (independently-safe) Ideal pipeline and spend Gemini quota even while the
// feature is dark. Go-live wants a true server backstop: the idealRun branch
// must consult idealLevelEnabled() server-side and, when it is OFF, REFUSE with
// a 422 and zero artifact BEFORE any model call -- mirroring the existing
// embedded / empty-resume refusals -- and PROCEED only when it is ON.
//
// Reachability: both branches are driven through the REAL exported POST handler
// with a real tailorMode=ideal FormData, exactly as route.ideal.test.js does --
// the same entry a crafted client reaches. No internal gate function is called
// directly; the gate's VALUE is controlled by mocking the predicate module.
//
// RED on HEAD: route.js does not import or consult idealLevelEnabled() at all,
// so with the gate mocked OFF the route still runs the pipeline and returns 200
// (the OFF test's `422` and `tailorIdeal not called` assertions red -- a real
// red, the backstop is unbuilt). The ON test passes on HEAD already (the route
// runs the pipeline regardless) and is disclosed below as a positive control
// that becomes load-bearing the moment the gate is wired: paired with the OFF
// test it pins that the branch CONSULTS the gate rather than ignoring it.
//
// Satisfiability proven in the scratchpad reference (adds the server gate check
// + flips idealLevelEnabled on): OFF->422/zero-artifact, ON->200 both green.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

// The gate predicate is the single flip-point (lib/tailor/idealDelivery.js).
// Mocked so ON/OFF can be driven independently of the committed default; every
// other export of the module is kept real via importOriginal.
const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/tailor/idealDelivery.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, idealLevelEnabled: () => gate.enabled };
});

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { registerEngine } from "@/lib/llm/engines";
import * as route from "./route.js";

const { POST } = route;

function fakeSupabase(userId) {
  return { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) } };
}

function textFile(name, content, type = "text/plain") {
  const f = new File([content], name, { type });
  f.text = async () => content;
  return f;
}

function idealRequest() {
  const fd = new FormData();
  fd.append("jobPosting", "We need a payments engineer.");
  fd.append("resume", textFile("resume.txt", "Jane Doe\nEngineer\nReduced tickets at Acme."));
  fd.append("templateLines", JSON.stringify(["Jane Doe", "Engineer"]));
  fd.append("engine", "gemini");
  fd.append("tailorMode", "ideal");
  return { formData: async () => fd };
}

// A capable Gemini stub whose tailorIdeal is a spy, so "the gate refused before
// any model ran" is measurable as a zero-call.
function capableGemini(tailorIdeal) {
  const engine = {
    name: "gemini",
    supportsIdeal: true,
    async tailorResume() {
      return { engine: "gemini", result: "STANDARD", resultLines: ["STANDARD"], jobTitle: "T", companyName: "C" };
    },
    async tailorCoverLetter() {
      return { engine: "gemini", result: "", resultLines: [] };
    },
    async tailorHiringEmail() {
      return null;
    },
    tailorIdeal,
  };
  registerEngine(engine);
  return engine;
}

const goodIdeal = () =>
  vi.fn(async () => ({
    postingAnalysis: {},
    keywordMap: {},
    hypothetical: { result: "HYPO", resultLines: ["HYPO"], jobTitle: "T", companyName: "C" },
    applicationReadyCandidate: {
      result: "Reduced tickets at Acme.",
      resultLines: ["Reduced tickets at Acme."],
      jobTitle: "T",
      companyName: "C",
    },
  }));

beforeEach(() => {
  gate.enabled = true;
  vi.clearAllMocks();
  createClient.mockResolvedValue(fakeSupabase(null));
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", resumeEngine: "gemini" });
});

describe("VF-1 -- the Ideal branch is a server backstop, not just a UI gate", () => {
  it("gate OFF: a crafted tailorMode=ideal POST is REFUSED with 422, ZERO artifact, and tailorIdeal is never called", async () => {
    gate.enabled = false;
    const tailorIdeal = goodIdeal();
    capableGemini(tailorIdeal);

    const res = await POST(idealRequest());

    // RED on HEAD: the route ignores the gate, runs the pipeline and returns 200.
    expect(res.status).toBe(422);
    const body = await res.json();
    // Zero artifact: none of the Ideal output keys are present, and no quota spent.
    expect(body).not.toHaveProperty("ideal");
    expect(body).not.toHaveProperty("result");
    expect(tailorIdeal).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL -- gate ON: the same request PROCEEDS (200 with an `ideal` block, tailorIdeal called)", async () => {
    // Discipline disclosure: this assertion ALREADY passes on HEAD, because the
    // route runs the Ideal pipeline regardless of the gate. It is not vacuous --
    // paired with the OFF test above it pins that the branch CONSULTS the gate
    // (a mutant that always-422s to build the backstop reds THIS test; a mutant
    // that ignores the gate to keep running reds the OFF test). After the gate
    // is wired it proves the backstop still lets a live run through.
    gate.enabled = true;
    const tailorIdeal = goodIdeal();
    capableGemini(tailorIdeal);

    const res = await POST(idealRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ideal).toBeTruthy();
    expect(tailorIdeal).toHaveBeenCalledTimes(1);
  });

  it("NO-OP CONTROL -- a standard (non-ideal) run is untouched by the gate in EITHER state", async () => {
    // The kill-switch governs only the Ideal branch. A standard run returns 200
    // whether the gate is on or off; if a build wired the gate to the whole
    // route this control reds. Runs the real standard path (tailorResume).
    for (const enabled of [true, false]) {
      gate.enabled = enabled;
      capableGemini(goodIdeal());
      const fd = new FormData();
      fd.append("jobPosting", "We need a payments engineer.");
      fd.append("resume", textFile("resume.txt", "Jane Doe\nEngineer"));
      fd.append("templateLines", JSON.stringify(["Jane Doe"]));
      fd.append("engine", "gemini");
      fd.append("aggressiveness", "3");
      const res = await POST({ formData: async () => fd });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).not.toHaveProperty("ideal");
    }
  });
});
