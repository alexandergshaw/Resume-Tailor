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
import { controlName, accessibleName } from "./prepPanelInstruments.js";

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
 *  the dialog's own Close buttons write. */
export function dialogProps(id, { open = true, spy = () => {} } = {}) {
  return {
    appDialog: open ? { open: true, rowIndex: 0, kind: "prep" } : { open: false, rowIndex: null, kind: "jd" },
    setAppDialog: spy,
    applicationData: [appRow(id)],
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
  return controlNamed(/^regenerate$/i);
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
