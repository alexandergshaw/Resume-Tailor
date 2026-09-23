// N50: the shared harness for the dialog-mounted prep tests (the real
// AppViewDialog, a stubbed global fetch, real clicks). Plain helpers only --
// each test file owns its own root, container and afterEach, so nothing here
// holds state between tests.
//
// HYGIENE THE MODULE-SCOPE QUEUE DEMANDS (plan.r2.md M5/R7): the N53 queue is
// one store per browser session, so it outlives every test in a file and
// cannot be reset (a reset export would move the export sweep). Every dialog
// test therefore mounts a FRESH application id from `freshAppId`, releases
// every deferred it holds before it ends, and each file carries a positive
// control (L-3) proving a fresh id starts clean.

import { act } from "react";
import { vi } from "vitest";
import { controlName, accessibleName } from "./prepPanelInstruments.js";
import { maximalGetResponse } from "./prepMaximalFixture.js";

let idCounter = 0;
/** A unique application id per call, across the whole test process. */
export function freshAppId(tag) {
  idCounter += 1;
  return `app-${tag}-${idCounter}`;
}

export function appRow(id, { description = "Build payment surfaces for the Dublin platform team." } = {}) {
  return {
    id,
    status: "interviewing",
    applied_at: "2026-09-01T00:00:00.000Z",
    application_url: null,
    positions: { id: `pos-${id}`, company: "Northwind Payments", title: "Staff Frontend Engineer", url: null, description },
    generated_resumes: null,
  };
}

/** AppViewDialog props exactly as TrackingTab passes them (TrackingTab.js
 *  renders <AppViewDialog> with these nine props). `open: false` is the shape
 *  the dialog's own Close buttons write.
 *
 *  N50 fix round 7 (verify.r7.md minor m-4): `hasDescription` -- additive,
 *  defaults `true` -- lets a caller build the dialog-level sweep's own row
 *  with no job description, exactly like `appRow`'s own `description`
 *  override, without every existing call site having to pass it. */
export function dialogProps(id, { open = true, spy = () => {}, hasDescription = true } = {}) {
  return {
    appDialog: open ? { open: true, rowIndex: 0, kind: "prep" } : { open: false, rowIndex: null, kind: "jd" },
    setAppDialog: spy,
    applicationData: [appRow(id, hasDescription ? {} : { description: "" })],
    communicationsDialog: { open: false, items: [] },
    loadCommunicationsForApp: spy,
    openAddCommunicationDialog: spy,
    digestsById: {},
    researchingIds: new Set(),
    researchOne: spy,
  };
}

export function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** M2/B-1 (N50 fix rounds 1 and 3): the shape the real server returns to a
 *  GET issued WHILE a claim is live -- `status:"running"`, pack blanked to
 *  the normalized-empty shape (route.js's own GATE 9; claim_prep_pack_slot
 *  clears the row before any content exists) -- never a fully-populated
 *  pack, which `interview_prep_packs_running_has_no_content`
 *  (supabase/migrations/20260914000000_interview_prep.sql:179-180) makes
 *  impossible while `status` is `"running"`. AppViewDialog.
 *  prepQueueLifetime.test.js carries the identical, independently-landed
 *  first copy of this shape (its own `runningGet()`); shared here so a
 *  second dialog-mounted file (AppViewDialog.prepTimeout.test.js) never
 *  re-derives the same server contract by hand -- the exact defect
 *  verify.r3.md's B-1 found in that file's own OLD fixture.
 *
 *  M-2 (N50 fix round 4, verify4.md): built from `maximalGetResponse()`,
 *  blanking ONLY the three fields `claim_prep_pack_slot` (route.js's own
 *  claim RPC) actually clears -- `pack`, `completeSections`, `status`.
 *  verify4.md measured that the OLD, hand-written copy here also zeroed
 *  `sectionRevisions`, `liveRevisions`, `candidateName` and
 *  `interviewerNames`, which the claim never touches (those come from
 *  `listSectionRevisions`/`readTrustedNames`, separate tables the RPC never
 *  writes) -- so every dialog-mounted case built on the OLD fixture was
 *  blind to whatever that unfaithfulness hid. Any field a future reader
 *  adds to `maximalGetResponse()` is faithful here BY CONSTRUCTION, rather
 *  than needing a matching hand-edit in a second, independently-maintained
 *  copy. */
export function runningPrepGetBody() {
  return {
    ...maximalGetResponse(),
    pack: {
      version: undefined,
      sections: {
        aboutYou: { answer: { lines: [] } },
        whyRole: { answer: { lines: [] } },
        askThem: { questions: [] },
        stages: { stages: [] },
      },
      claims: [],
    },
    status: "running",
    completeSections: [],
  };
}

/** N50 fix round 7 (verify.r7.md M-2): a hung POST paired with a `running`
 *  GET answer that is NOT tied to that same promise ever settling.
 *  AppViewDialog.prepTimeout.test.js's own `stubFetchWithHangingPost` flips
 *  its `pending` flag the moment THIS session's own POST is sent, so every
 *  later GET reporting `running` is reporting the tail of that SAME
 *  request -- useful for proving the claim's own lease can outlive the
 *  client's timeout, but it cannot model a genuinely DIFFERENT run being
 *  live, since nothing in it is independent of this session's own click.
 *  `setExternalRunLive` is a separate switch the caller controls directly.
 *  N50 final polish (verify.r8.md minor m-3): the order a case actually
 *  needs is the OPPOSITE of what this used to say -- flip the switch BEFORE
 *  advancing past the click's own timeout, not well past it and only then.
 *  AppViewDialog.prepTimeout.test.js's own caller does exactly that, because
 *  the settled handler's automatic refetch fires the instant the client
 *  gives up (still inside that same `advance`): flipping any later would let
 *  that refetch land on the untouched `maximalGetResponse()` answer first,
 *  retiring the section's own timedOut outcome as provably over before the
 *  scenario ever gets to run. Flipping early honestly models a claim that
 *  was already live when this session's own request went out -- a run this
 *  session never started, not one it is merely slow to notice. */
export function stubFetchWithDifferentRunLive() {
  const posts = { count: 0 };
  let externalRunLive = false;
  const f = vi.fn((url, init) => {
    if (!init || !init.method || init.method === "GET") {
      return Promise.resolve(jsonResponse(externalRunLive ? runningPrepGetBody() : maximalGetResponse()));
    }
    posts.count += 1;
    return new Promise((resolve, reject) => {
      if (!init.signal) return;
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
  vi.stubGlobal("fetch", f);
  return {
    posts,
    fetchMock: f,
    setExternalRunLive: (v) => {
      externalRunLive = v;
    },
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export function click(node) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Every control a person can activate, anywhere in the document (MUI's
 *  Dialog portals to document.body, never into the mount container). */
export function allControls() {
  return [...document.body.querySelectorAll('button, [role="button"], summary')];
}

export function controlNamed(re) {
  return allControls().find((node) => re.test(controlName(node))) || null;
}

/** The POST/PATCH/PUT calls a fetch spy recorded, as `{method, body}`. */
export function mutations(fetchMock) {
  return fetchMock.mock.calls
    .filter(([, init]) => init && init.method && init.method !== "GET")
    .map(([url, init]) => ({ url, method: init.method, body: JSON.parse(init.body) }));
}

export function getCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([, init]) => !init || !init.method || init.method === "GET");
}

/** Section labels as the panel shows them (PrepPackPanel.js SECTION_LABELS). */
export const LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};

export function sectionRegenerateControl(section) {
  return controlNamed(new RegExp(`^regenerate ${LABELS[section]}$`, "i"));
}

export function wholePackRegenerateControl() {
  // M1 (N50 fix round 1): was `/^regenerate$/i` -- the whole-pack control's
  // own accessible name is now "Regenerate whole pack", so it is never
  // identical to a section's own "Regenerate {label}" control.
  return controlNamed(/^regenerate whole pack$/i);
}

/** INVARIANT (N50 fix round 4): the manual escape hatch PrepPackPanel.js
 *  offers for the one `in-flight` shape nothing else resolves on its own --
 *  see that file's own `showCheckAgain` header. */
export function checkAgainControl() {
  return controlNamed(/^check again$/i);
}

/** INVARIANT (N50 fix round 4, verify4.md): every control anywhere in the
 *  document that can actually MOVE THE GENERATION FORWARD -- a whole-pack or
 *  per-section Regenerate, a Restore, the absent state's "Prepare me...", or
 *  "Check again". Deliberately excludes "Download prep log" and the names
 *  strip's Edit/Add/Save/Cancel: those are always present and always
 *  enabled regardless of state, so counting them would make the sweep pass
 *  vacuously on exactly the zero-control state it exists to catch
 *  (verify4.md's own B-1 measured "actionable controls: none" through
 *  states where those controls kept rendering).
 *
 *  N50 fix round 5 (verify.r5.md minor m-1): "Add a job description" --
 *  the no-description state's own forward control (PrepPackPanel.js's
 *  `GenerateControl`) -- joins the recognized set. Named precisely, not
 *  merely `/^add\b/`, so it is never confused with the names strip's own
 *  "Add" button for a missing candidate/interviewer name -- that control
 *  is deliberately still excluded (it is always present, per the header
 *  above).
 *
 *  N50 fix round 5 (verify.r5.md minor m-2): PRESENCE alone used to be
 *  enough -- a `disabled` (or `aria-disabled="true"`) control still counted,
 *  which is not "at least one control that can move the generation
 *  forward". Production code never intentionally disables one of these (DX
 *  §8's a11y rule, already followed everywhere in this feature), so this
 *  exclusion guards a REGRESSION, not a reachable state; disabled controls
 *  found elsewhere in the document ("Previous"/"Next" when there is only one
 *  page) were never counted by the name filter above and stay unaffected. */
export function forwardControls() {
  return allControls().filter(
    (node) =>
      /^(regenerate\b|restore\b|prepare me for this interview$|check again$|add a job description$)/i.test(controlName(node)) &&
      !node.disabled &&
      node.getAttribute("aria-disabled") !== "true",
  );
}

/** One real activation of `section`'s history disclosure, if the build has
 *  one; returns the number of activations spent (0 or 1). */
export async function openHistory(section) {
  const summary = allControls().find(
    (node) => node.tagName.toLowerCase() === "summary" && controlName(node).includes(LABELS[section]) && /version|history|earlier|previous/i.test(controlName(node)),
  );
  if (!summary) return 0;
  if (summary.parentElement.open) return 0;
  await click(summary);
  return 1;
}

export function restoreControl(section, revision) {
  return controlNamed(new RegExp(`^restore ${LABELS[section]} version ${revision}$`, "i"));
}

/** The `role="alert"` regions that sit outside every section group -- i.e.
 *  the panel-foot, whole-pack alert. */
export function footAlerts() {
  return [...document.body.querySelectorAll('[role="alert"]')].filter((n) => !n.closest('[role="group"]'));
}

export function groupAlerts(section) {
  const group = [...document.body.querySelectorAll('[role="group"]')].find((g) => accessibleName(g) === LABELS[section]);
  return group ? [...group.querySelectorAll('[role="alert"]')] : null;
}

export function sectionGroup(section) {
  return [...document.body.querySelectorAll('[role="group"]')].find((g) => accessibleName(g) === LABELS[section]) || null;
}
