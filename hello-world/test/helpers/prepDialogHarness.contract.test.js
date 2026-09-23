// @vitest-environment jsdom
//
// N50 fix round 5 (verify.r5.md M-3/m-2) -- the shared prep-dialog test
// harness has never had its own canary file (unlike prepMaximalFixture.js
// and prepPanelInstruments.js beside it). Two things landed this round that
// nothing else pins directly:
//   * `runningPrepGetBody()`'s own contract -- the SIX fields
//     `claim_prep_pack_slot` never touches must stay faithful to
//     `maximalGetResponse()`, and the THREE it does clear must stay blanked.
//     Mutant X1 (verify.r5.md M-3): putting the four unfaithful fields back
//     (`sectionRevisions: {}`, `liveRevisions: {}`, `candidateName: null`,
//     `interviewerNames: []`) on top of the spread survived 0/493 -- nothing
//     anywhere read the fixture's own shape. This file is that assertion.
//   * `forwardControls()`'s new actionability filter (verify.r5.md minor
//     m-2): PRESENCE used to be enough; a `disabled` or `aria-disabled`
//     control still counted, which is not "a control that can move the
//     generation forward". Pinned directly against a synthetic DOM fragment,
//     since production code never disables one of these controls on its own
//     (DX §8's a11y rule) -- this guards a regression, not a reachable state.

import { describe, it, expect } from "vitest";
import { runningPrepGetBody, forwardControls, stubFetchWithDifferentRunLive, jsonResponse } from "./prepDialogHarness.js";
import { maximalGetResponse } from "./prepMaximalFixture.js";

describe("runningPrepGetBody -- faithful to the real route's own claim_prep_pack_slot behaviour", () => {
  it("blanks ONLY pack, completeSections and status -- every other field matches maximalGetResponse() exactly", () => {
    const running = runningPrepGetBody();
    const maximal = maximalGetResponse();
    expect(running.status).toBe("running");
    expect(running.completeSections).toEqual([]);
    expect(running.pack).not.toEqual(maximal.pack);
    // the fields the claim RPC never touches (listSectionRevisions/
    // readTrustedNames read separate tables) must be carried through
    // UNCHANGED -- never re-blanked by a second, independently maintained copy.
    expect(running.sectionRevisions).toEqual(maximal.sectionRevisions);
    expect(running.liveRevisions).toEqual(maximal.liveRevisions);
    expect(running.candidateName).toBe(maximal.candidateName);
    expect(running.interviewerNames).toEqual(maximal.interviewerNames);
  });

  it("[precondition] the fields it must carry through are themselves non-empty in the source fixture -- otherwise the check above is vacuous", () => {
    const maximal = maximalGetResponse();
    expect(Object.keys(maximal.sectionRevisions).length).toBeGreaterThan(0);
    expect(Object.keys(maximal.liveRevisions).length).toBeGreaterThan(0);
    expect(typeof maximal.candidateName).toBe("string");
    expect(maximal.candidateName.length).toBeGreaterThan(0);
    expect(maximal.interviewerNames.length).toBeGreaterThan(0);
  });

  it("[canary: mutant X1] re-blanking the four faithful fields on top of the real shape is caught", () => {
    // The exact mutation verify.r5.md found undefended, reproduced directly
    // against a COPY (never mutating the real module) so this file proves
    // the assertion style above actually discriminates it.
    const unfaithful = {
      ...runningPrepGetBody(),
      sectionRevisions: {},
      liveRevisions: {},
      candidateName: null,
      interviewerNames: [],
    };
    const maximal = maximalGetResponse();
    expect(unfaithful.sectionRevisions).not.toEqual(maximal.sectionRevisions);
    expect(unfaithful.candidateName).not.toBe(maximal.candidateName);
  });
});

describe("forwardControls -- excludes a disabled or aria-disabled control, not merely by name", () => {
  function mount(html) {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  }

  it("a disabled 'Regenerate' button is not counted", () => {
    const container = mount('<button disabled>Regenerate whole pack</button>');
    try {
      expect(forwardControls()).toEqual([]);
    } finally {
      container.remove();
    }
  });

  it("an aria-disabled='true' 'Check again' button is not counted", () => {
    const container = mount('<button aria-disabled="true">Check again</button>');
    try {
      expect(forwardControls()).toEqual([]);
    } finally {
      container.remove();
    }
  });

  it("[positive control] the SAME control, enabled, is counted", () => {
    const container = mount("<button>Check again</button>");
    try {
      expect(forwardControls()).toEqual([container.querySelector("button")]);
    } finally {
      container.remove();
    }
  });

  it("recognizes 'Add a job description' (N50 fix round 5, minor m-1) without matching the names strip's bare 'Add'", () => {
    const container = mount('<button>Add a job description</button><button>Add</button>');
    try {
      const names = forwardControls().map((n) => (n.textContent || "").trim());
      expect(names).toEqual(["Add a job description"]);
    } finally {
      container.remove();
    }
  });
});

// N50 final polish (verify.r8.md minor m-1) -- `stubFetchWithDifferentRunLive`
// (N50 fix round 7) was built to model a claim genuinely independent of this
// session's own POST, unlike AppViewDialog.prepTimeout.test.js's own
// `stubFetchWithHangingPost`, which ties its `pending` flag to the moment
// THIS session's own POST is sent -- so under that older stub, a GET issued
// the instant a POST goes out already answers `running`, for a reason that
// has nothing to do with any OTHER run. verify.r8.md's own mutant C1 (that
// call site reverted to the older stub, with `setExternalRunLive` turned into
// a no-op) survived 0/428: nothing anywhere exercises a GET in the window
// between a POST being sent and the switch being flipped, which is exactly
// where the two stubs diverge. This file has no dialog to mount, so it pins
// the divergence directly against the stub's own return value.
describe("stubFetchWithDifferentRunLive -- the external-run switch, not any POST of this session's own, controls a GET's answer", () => {
  it("a GET issued right after this session's own POST, before the switch is flipped, still answers normally", async () => {
    const { fetchMock, posts, setExternalRunLive } = stubFetchWithDifferentRunLive();
    fetchMock("/api/interview-prep?applicationId=app-1", { method: "POST", signal: new AbortController().signal });
    expect(posts.count, "precondition: the POST was sent").toBe(1);

    const beforeSwitch = await fetchMock("/api/interview-prep?applicationId=app-1").then((r) => r.json());
    expect(
      beforeSwitch.status,
      "a POST already in flight must not itself make a GET answer running -- only the explicit switch may",
    ).not.toBe("running");

    setExternalRunLive(true);
    const afterSwitch = await fetchMock("/api/interview-prep?applicationId=app-1").then((r) => r.json());
    expect(afterSwitch.status, "flipping the switch is what makes a GET answer running").toBe("running");

    setExternalRunLive(false);
    const afterRevert = await fetchMock("/api/interview-prep?applicationId=app-1").then((r) => r.json());
    expect(afterRevert.status, "the switch can flip back").not.toBe("running");
  });

  it("[canary] the older stub's own pending-on-POST wiring could not pass the assertion above -- proving the two are not interchangeable", async () => {
    // Reproduces AppViewDialog.prepTimeout.test.js's own `stubFetchWithHangingPost`
    // GET rule against a throwaway copy -- never mutating either real module
    // -- to prove the assertion style above actually discriminates the two
    // stubs' wire behaviour, the way X1's own canary does above.
    let pending = false;
    const oldStyleGet = () => Promise.resolve(jsonResponse(pending ? runningPrepGetBody() : maximalGetResponse()));
    pending = true; // set the instant a POST is "sent", exactly as the older stub does
    const beforeSwitch = await oldStyleGet().then((r) => r.json());
    expect(
      beforeSwitch.status,
      "the older stub already answers running here -- it cannot tell a genuinely different run apart from this session's own POST",
    ).toBe("running");
  });
});
