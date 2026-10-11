// N157 SC-C sub-chunk C-c (4b TDD seat) -- the LAZY Supabase binding (F-3 HARD
// GATE). Binds to docs/loop/N157.SC-C.design.r2.md section 5.6 (the import graph
// must be inert) and section 5.2 (the seven mock-site suites cannot pass if any
// module in the new graph runs an effect at import). Ledger DES-N157-C23.
//
// WHY THIS FILE IS THE CHEAP HALF OF THE HARD GATE. After the PracticeSurface
// rename, all seven `vi.mock("./practice/PracticeClient")` suites load
// StudyPlanClient's whole import graph -- including studyPlanBrowser -- in jsdom,
// although none of them renders the Study view. A `createClient()` or
// `auth.getUser()` call at module scope (or in a module-level const, or an
// import-time default) runs `createBrowserClient(...)` at collection and reds
// all seven suites at once (and throws on the first paint of practice mode in a
// browser with no env). This file pins the rule those suites depend on, in a
// node environment where it is a one-line assertion instead of a seven-suite
// forensic hunt.
//
// RED on HEAD: lib/studyPlan/studyPlanBrowser.js does not exist yet, so the
// dynamic import in beforeEach throws "cannot find module" and every `it` reds
// -- the honest greenfield red. Each `it` still carries a real behavioural
// assertion so a reference turns it green for the right reason.
//
// THE MUTANT THIS FILE IS BUILT TO KILL (watched in tests.r1.md): move the
// `createClient()` call to module scope (an eager `const client = createClient()`
// at the top of the file, or inside a module-level default). The throwing-client
// import test below then reds, because the throw fires at import.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The transport is mocked as a spy whose implementation each test sets. A
// DEFAULT implementation here would hide an eager call (the import-time test
// needs the spy to exist with ZERO calls), so the default returns a usable fake
// client and the throwing test overrides it per test.
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

// The data layer is mocked so the binding can be exercised without a real client
// or network: these are the two shipped functions the binding wraps. Their own
// behaviour is covered by studyPlanStore.test.js; here they are call sinks.
const readStudyPlan = vi.fn(async () => ({ status: null, plan: null, error: null }));
const writeStudyPlanProgress = vi.fn(async () => ({ written: true, error: null }));
vi.mock("@/lib/studyPlan/studyPlanStore.js", () => ({
  readStudyPlan: (...a) => readStudyPlan(...a),
  writeStudyPlanProgress: (...a) => writeStudyPlanProgress(...a),
}));

const APP_ID = "11111111-1111-1111-1111-111111111111";

let createClientSpy;
let getUser;

// A fake browser client: only the surface the binding touches. getUser is a spy
// so "how many times did the binding resolve identity" is directly measurable.
function makeClient() {
  getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
  return { auth: { getUser } };
}

async function loadModule() {
  // A fresh module each test: the binding's per-binding memo is closure state,
  // but resetting modules keeps one test's import from masking another's
  // import-time behaviour.
  vi.resetModules();
  return import("@/lib/studyPlan/studyPlanBrowser.js");
}

beforeEach(async () => {
  const clientMod = await import("@/lib/supabase/client");
  createClientSpy = clientMod.createClient;
  createClientSpy.mockReset();
  createClientSpy.mockImplementation(() => makeClient());
  readStudyPlan.mockClear();
  writeStudyPlanProgress.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("studyPlanBrowser is INERT at import (F-3 hard gate)", () => {
  it("importing it makes ZERO createClient() calls", async () => {
    await loadModule();
    // The whole point of the hard gate: the seven mock-site suites load this
    // module and must not pay a client construction for it.
    expect(createClientSpy).toHaveBeenCalledTimes(0);
  });

  it("merely BINDING an application makes ZERO createClient() / getUser() calls (lazy until first use)", async () => {
    const mod = await loadModule();
    mod.bindStudyPlan(APP_ID);
    expect(createClientSpy).toHaveBeenCalledTimes(0);
  });

  it("a createClient that THROWS at construction does not throw at import, nor when binding", async () => {
    // This is the exact failure the seven suites would hit if the call were
    // eager: createBrowserClient throws when NEXT_PUBLIC_SUPABASE_* are absent.
    createClientSpy.mockImplementation(() => {
      throw new Error("no env");
    });
    const mod = await loadModule();
    expect(() => mod.bindStudyPlan(APP_ID)).not.toThrow();
    expect(createClientSpy).toHaveBeenCalledTimes(0);
  });
});

describe("The binding constructs the client only on first use (positive control)", () => {
  it("reader() makes EXACTLY ONE createClient call, and one getUser, across repeated calls", async () => {
    const mod = await loadModule();
    const { reader } = mod.bindStudyPlan(APP_ID);

    // Positive control: a spy that CAN fire. If the binding never reached the
    // transport the counts below would be 0 and this test would red -- so it is
    // not a vacuous "nothing happened" assertion.
    await reader();
    expect(createClientSpy).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);

    await reader();
    // Memoised: a second read neither re-constructs the client nor re-resolves
    // identity (getUser() is a network round trip; per-call would tax every card).
    expect(createClientSpy).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("reader() reads the plan scoped to {applicationId, userId} resolved from getUser", async () => {
    const mod = await loadModule();
    const { reader } = mod.bindStudyPlan(APP_ID);
    await reader();
    expect(readStudyPlan).toHaveBeenCalledTimes(1);
    const [, args] = readStudyPlan.mock.calls[0];
    expect(args.applicationId).toBe(APP_ID);
    expect(args.userId).toBe("user-1");
  });

  it("a thrown client surfaces as an error RESULT the store can settle on, never an unhandled rejection", async () => {
    createClientSpy.mockImplementation(() => {
      throw new Error("no env");
    });
    const mod = await loadModule();
    const { reader } = mod.bindStudyPlan(APP_ID);
    // reader never rejects: the store's loadStudyPlanRecord awaits it and a
    // rejection would blow up a mount. It resolves to a record carrying the error.
    const record = await reader();
    expect(record).toBeTypeOf("object");
    expect(record.plan).toBeNull();
    expect(typeof record.error).toBe("string");
    expect(record.error.length).toBeGreaterThan(0);
  });

  it("writer() makes ZERO getUser calls (identity is auth.uid() inside the RPC)", async () => {
    const mod = await loadModule();
    const { writer } = mod.bindStudyPlan(APP_ID);
    const cursor = { itemId: "k1" };
    const seenDelta = { k1: { revealedAt: "2026-01-01T00:00:00.000Z" } };
    await writer({ cursor, seenDelta });
    // writer constructs the client (one createClient) but never resolves identity:
    // a getUser here would add a round trip to every progress write.
    expect(getUser).toHaveBeenCalledTimes(0);
    expect(writeStudyPlanProgress).toHaveBeenCalledTimes(1);
    const [, args] = writeStudyPlanProgress.mock.calls[0];
    expect(args.applicationId).toBe(APP_ID);
    expect(args.cursor).toEqual(cursor);
    expect(args.seenDelta).toEqual(seenDelta);
  });
});
