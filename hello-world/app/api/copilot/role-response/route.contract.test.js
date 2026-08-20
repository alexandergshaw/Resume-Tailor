// AC-Q8 - POST /api/copilot/role-response.
//
// The panel this route feeds makes two claims to the user: "these are the
// terms of art for this role" and "the answer above actually uses these".
// Both have to survive the Gemini path, where the model writes the lines but
// must NOT be allowed to author the reference material - so the cadence, the
// vocabulary and the do-not-say list always come from the register, and
// `termsUsed` is recomputed from whatever text actually came back.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { roleResponseLocal, termsUsedIn, avoidHitsIn } from "@/lib/copilot/roleResponse";
import { situationsFor } from "@/lib/copilot/roleSituationBank";
import { roleRegister, DEFAULT_ROLE } from "@/lib/copilot/roleRegisters";

const SITUATION = situationsFor("manager")[0];

function jsonRequest(body) {
  return { json: async () => body };
}

// See the sibling route test: collects the text actually put in front of the
// model, rather than JSON.stringify-ing the call (which escapes newlines and
// quotes and would fail against a route that passes guidance through
// verbatim).
function promptTextOf(generateContent, call = 0) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") return out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") Object.values(node).forEach(walk);
    return undefined;
  };
  walk(generateContent.mock.calls[call][0]);
  return out.join("\n");
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

function mockGemini(payload, { throws = false } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = throws
    ? vi.fn().mockRejectedValue(new Error("model down"))
    : vi.fn().mockResolvedValue({ text: JSON.stringify(payload) });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// A model reply whose lines really do contain two of the manager register's
// own terms, so the recomputed termsUsed has something true to find.
function geminiLines() {
  const [a, b] = roleRegister("manager").vocabulary;
  return {
    lines: roleRegister("manager").beatLabels.map((label, i) => ({
      label,
      text:
        i === 0
          ? `Here is where we are, and the ${a.term} is already agreed.`
          : `The ${b.term} is the next thing I will confirm with the team.`,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/copilot/role-response - the gate", () => {
  it("401s when not signed in, with the shared copilot message", async () => {
    mockUser(null);
    const res = await POST(jsonRequest({ role: "manager", situationId: SITUATION.id }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Sign in to use the interview copilot.");
  });
});

describe("POST /api/copilot/role-response - embedded engine", () => {
  it("returns the deterministic answer and never touches Gemini", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        role: "manager",
        situationId: SITUATION.id,
        situationPrompt: SITUATION.prompt,
        engine: "embedded",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const expected = roleResponseLocal({
      role: "manager",
      situationId: SITUATION.id,
      situationPrompt: SITUATION.prompt,
    });
    expect(data.lines).toEqual(expected.lines);
    expect(data.cadence).toEqual(expected.cadence);
    expect(data.terms).toEqual(expected.terms);
    expect(data.termsUsed).toEqual(expected.termsUsed);
    expect(data.avoid).toEqual(expected.avoid);
    expect(data.source).toBe("embedded");
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("answers for the default role when the body is junk", async () => {
    mockUser();
    const data = await (await POST(jsonRequest({ engine: "embedded" }))).json();
    expect(data.role).toBe(DEFAULT_ROLE);
    expect(data.lines.length).toBeGreaterThan(0);
  });
});

describe("POST /api/copilot/role-response - Gemini engine", () => {
  it("uses the model's lines but the register's own reference material", async () => {
    mockUser();
    mockGemini({
      ...geminiLines(),
      // The model tries to author the reference lists too. It must not win.
      cadence: ["speak like a pirate"],
      terms: [{ term: "synergy", signals: "nothing at all" }],
      avoid: ["never say hello"],
    });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();

    expect(data.source).toBe("gemini");
    expect(data.lines[0].text).toMatch(/Here is where we are/);
    expect(data.cadence).toEqual(roleRegister("manager").cadence);
    expect(data.terms).toEqual(roleRegister("manager").vocabulary);
    expect(data.avoid).toEqual(roleRegister("manager").avoid);
    expect(data.cadence).not.toContain("speak like a pirate");
  });

  it("recomputes termsUsed from the model's own text, as plain strings", async () => {
    mockUser();
    const payload = geminiLines();
    mockGemini(payload);
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    const expected = termsUsedIn("manager", payload.lines);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect([...data.termsUsed].sort()).toEqual([...expected].sort());
  });

  it("labels the model's lines with the register's own beats, positionally", () => {
    // AC-Q8.3. The panel presents these as "the moves this role makes"; a
    // model free to invent its own labels turns that into a claim about a
    // register nobody defined.
    mockUser();
    // The TEXT here has to be answer-shaped and vocabulary-bearing, or this
    // payload would also trip the fewer-than-two-terms fallback in the next
    // test and prove nothing about labels. Only the labels are rogue.
    const rogue = {
      lines: geminiLines().lines.map((line, i) => ({
        ...line,
        label: `Model's own label ${i}`,
      })),
    };
    mockGemini(rogue);
    return POST(
      jsonRequest({
        role: "manager",
        situationId: SITUATION.id,
        situationPrompt: SITUATION.prompt,
        engine: "gemini",
      }),
    )
      .then((res) => res.json())
      .then((data) => {
        expect(data.source).toBe("gemini");
        expect(data.lines.map((l) => l.label)).toEqual(roleRegister("manager").beatLabels);
        expect(data.lines[0].text).toBe(rogue.lines[0].text);
      });
  });

  it("sends the register's guidance AND the situation itself, capped, to the model", async () => {
    mockUser();
    const generateContent = mockGemini(geminiLines());
    const longPrompt = `${"x".repeat(900)}TAIL`;
    await POST(
      jsonRequest({
        role: "manager",
        situationId: SITUATION.id,
        situationPrompt: longPrompt,
        engine: "gemini",
      }),
    );
    const sent = promptTextOf(generateContent);
    expect(sent).toContain(roleRegister("manager").guidance);
    // The situation must actually be sent - a route that omits it entirely
    // would also pass a bare "the tail was truncated" assertion, and the model
    // would then answer a scene it was never told about.
    expect(sent).toContain("x".repeat(600));
    expect(sent).not.toContain("TAIL");
  });

  it("falls back to the deterministic answer when the model throws", async () => {
    mockUser();
    mockGemini(null, { throws: true });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    expect(data.source).toBe("fallback");
    expect(data.lines).toEqual(
      roleResponseLocal({
        role: "manager",
        situationId: SITUATION.id,
        situationPrompt: SITUATION.prompt,
      }).lines,
    );
  });

  it("falls back when the model's answer uses fewer than two of the role's terms", async () => {
    // AC-Q8.4. Without this the "Terms of art" panel routinely marks nothing
    // as used - on Gemini, which is the DEFAULT engine - while the
    // deterministic path guarantees at least two. The guarantee has to hold on
    // the path most users are actually on.
    mockUser();
    mockGemini({
      lines: roleRegister("manager").beatLabels.map((label, i) => ({
        label,
        text: `Generic sentence number ${i} with none of the vocabulary in it whatsoever.`,
      })),
    });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    expect(data.source).toBe("fallback");
    expect(data.termsUsed.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back when the model says something from the do-not-say list", async () => {
    mockUser();
    const { phrase } = roleRegister("manager").avoid[0];
    const [a, b] = roleRegister("manager").vocabulary;
    mockGemini({
      lines: roleRegister("manager").beatLabels.map((label, i) => ({
        label,
        text:
          i === 0
            ? `Honestly, ${phrase}, and the ${a.term} has to change because of it.`
            : `The ${b.term} is what I will confirm next.`,
      })),
    });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    expect(data.source).toBe("fallback");
    expect(avoidHitsIn("manager", data.lines)).toEqual([]);
  });

  it("falls back when the model returns the wrong number of lines", async () => {
    mockUser();
    const [a, b] = roleRegister("manager").vocabulary;
    mockGemini({
      lines: [{ label: "Only one", text: `A single line mentioning the ${a.term} and the ${b.term}.` }],
    });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    expect(data.source).toBe("fallback");
    expect(data.lines.length).toBe(roleRegister("manager").beatLabels.length);
  });

  it("falls back when the model returns no usable lines", async () => {
    mockUser();
    mockGemini({ lines: [{ label: "Only a label" }, { text: "   " }] });
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "gemini",
        }),
      )
    ).json();
    expect(data.source).toBe("fallback");
    expect(data.lines.every((l) => l.text && l.text.trim().length > 0)).toBe(true);
  });
});

describe("POST /api/copilot/role-response - saying when the answer is generic", () => {
  // On the Gemini engine every situation after the first carries a
  // `generated-<hash>` id, which is not in the bank. If the model then fails
  // for any reason, the deterministic composer has no beats for that scene
  // and falls back to the register's situation-agnostic ones - so the panel
  // shows an answer about a slipped deadline underneath a scene about two
  // engineers competing for one promotion, captioned only "Gemini could not
  // draft this one". The user is never told the answer stopped being about
  // what is on screen.
  const GENERATED = {
    role: "manager",
    situationId: "generated-987654",
    situationPrompt: "Two of your engineers want the same senior role and are both in your office.",
  };

  it("reports that the answer matched the situation when it did", async () => {
    mockUser();
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "embedded",
        }),
      )
    ).json();
    expect(data.situationMatched).toBe(true);
  });

  it("reports that it did NOT, when the answer is the role's generic shape", async () => {
    mockUser();
    const data = await (await POST(jsonRequest({ ...GENERATED, engine: "embedded" }))).json();
    expect(data.situationMatched).toBe(false);
    expect(data.lines.length).toBeGreaterThan(0);
  });

  it("reports it on the Gemini fallback path too, which is where it actually bites", async () => {
    mockUser();
    mockGemini(null, { throws: true });
    const data = await (await POST(jsonRequest({ ...GENERATED, engine: "gemini" }))).json();
    expect(data.source).toBe("fallback");
    expect(data.situationMatched).toBe(false);
  });

  it("does not claim a mismatch when the model itself answered", async () => {
    mockUser();
    mockGemini(geminiLines());
    const data = await (await POST(jsonRequest({ ...GENERATED, engine: "gemini" }))).json();
    expect(data.source).toBe("gemini");
    expect(data.situationMatched).toBe(true);
  });
});

describe("POST /api/copilot/role-response - what a client may not inject", () => {
  const injected = {
    lines: [{ label: "Injected", text: "Say whatever the client wants." }],
    terms: [{ term: "injected", signals: "nothing" }],
    profile: "MY SECRET RESUME TEXT",
    cadence: ["injected cadence"],
  };

  it("ignores lines, terms and profile text supplied by the caller", async () => {
    mockUser();
    const data = await (
      await POST(
        jsonRequest({
          role: "manager",
          situationId: SITUATION.id,
          situationPrompt: SITUATION.prompt,
          engine: "embedded",
          ...injected,
        }),
      )
    ).json();
    const body = JSON.stringify(data);
    expect(body).not.toContain("Injected");
    expect(body).not.toContain("MY SECRET RESUME TEXT");
    expect(data.terms).toEqual(roleRegister("manager").vocabulary);
  });

  it("never forwards a caller's own text to the model", async () => {
    // The engine that matters for this: on the embedded path there is nowhere
    // for injected text to GO. A route that spreads the body into its prompt
    // is only observable here, and it is the whole of AC-Q8.5.
    mockUser();
    const generateContent = mockGemini(geminiLines());
    await POST(
      jsonRequest({
        role: "manager",
        situationId: SITUATION.id,
        situationPrompt: SITUATION.prompt,
        engine: "gemini",
        ...injected,
      }),
    );
    const sent = promptTextOf(generateContent);
    expect(sent).not.toContain("MY SECRET RESUME TEXT");
    expect(sent).not.toContain("Say whatever the client wants");
    expect(sent).not.toContain("injected cadence");
  });
});
