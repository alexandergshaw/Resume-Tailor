// @vitest-environment jsdom
//
// AC-3a's vocabulary module (lib/applications/statusVocabulary.js) says there
// is ONE closed set of eleven `applications.status` values, and
// lib/supabase/applicationStatusWriter.js's `writeApplicationStatus` refuses
// BEFORE any IO (its own "C0" -- see the file header) when a caller's status
// falls outside that set. Three of this table's four write paths inherit
// that refusal: two app/page.js call sites and lib/feed/tailorAndQueue.js go
// through `writeApplicationStatus` directly or through its thin wrapper
// (lib/supabase/upsertApplication.js).
//
// The fourth -- `handleSaveAddApplication` in this file, the "Add
// Application" dialog's save -- issues a raw
// `supabase.from("applications").insert(...)` and carries NONE of that
// vocabulary check. It writes `addAppDialog.status` verbatim into a column
// backed by a live Postgres CHECK constraint (`applications_status_check`,
// see statusVocabulary.js's own header) with no JS-side defence at all.
//
// This is not merely theoretical because AddAppDialog.js's own `<Select>`
// happens to be bounded today: `handleSaveAddApplication` is a plain
// function that trusts whatever `addAppDialog.status` currently holds, the
// exact shape of gap `setApplicationStatusByUser`'s own docblock warns about
// for the EDIT dialog ("status here is not bounded by the eight the dialog
// lists"). Nothing about THIS function's own logic stops an off-vocabulary
// value from reaching the statement -- unlike every other write surface in
// this app.
//
// `makeStatefulSupabase` (test/helpers/supabaseFake.js) is a STATEFUL fake,
// so this test can assert the row never lands at all, not merely that some
// return value looked like an error.
//
// The `let latest` / direct-reassignment Probe idiom (not `.current` on an
// outer ref-like box) is the pattern eslint.config.mjs documents as the
// intended shape for jsdom hook-test harnesses in this repo (see its comment
// on `react-hooks/globals`, and app/copilot/useCopilotDashboard.noSpeculation.test.js
// for the worked example) -- `react-hooks/globals` is turned off for
// `**/*.test.js` for exactly this reassignment, whereas the sibling
// `react-hooks/immutability` rule (left on) flags a `.current` mutation
// through a prop-passed ref-like object, so that shape is avoided here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { createClient } from "@/lib/supabase/client";
import { upsertPosition } from "@/lib/supabase/upsertPosition";
import { useApplicationDialogs } from "./useApplicationDialogs.js";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/upsertPosition", () => ({
  upsertPosition: vi.fn(async () => "position-1"),
  editPositionFieldsViaApi: vi.fn(async () => ({ error: null })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: "user-1" };

let container;
let root;
let latest;

function Probe(props) {
  latest = useApplicationDialogs(props);
  return null;
}

function baseProps(overrides) {
  return {
    currentUser: USER,
    setApplicationData: vi.fn(),
    setApplicationStages: vi.fn(),
    setApplicationsRefreshKey: vi.fn(),
    confirm: vi.fn(),
    ...overrides,
  };
}

function seedSupabase() {
  return makeStatefulSupabase({ applications: [], positions: [] }, { user: USER });
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertPosition.mockResolvedValue("position-1");
  latest = null;
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

describe("handleSaveAddApplication -- the one applications-table write path with no status guard", () => {
  it("refuses an off-vocabulary status BEFORE any IO -- mirrors writeApplicationStatus's C0 guard", async () => {
    const sb = seedSupabase();
    createClient.mockReturnValue(sb);
    await mount(baseProps());

    await act(async () => {
      latest.setAddAppDialog((prev) => ({
        ...prev,
        open: true,
        company: "Acme",
        role: "Engineer",
        status: "not_a_real_status",
      }));
    });
    await flush();

    await act(async () => {
      await latest.handleSaveAddApplication();
    });

    // C0 parity: refuse before any IO happens, not even the position write.
    expect(upsertPosition).not.toHaveBeenCalled();
    expect(sb.rows("applications")).toEqual([]);
    expect(latest.addAppError).toMatch(/status/i);
  });

  it("still saves a legitimate, in-vocabulary status -- control proving the guard is not a blanket refusal", async () => {
    const sb = seedSupabase();
    createClient.mockReturnValue(sb);
    await mount(baseProps());

    await act(async () => {
      latest.setAddAppDialog((prev) => ({
        ...prev,
        open: true,
        company: "Acme",
        role: "Engineer",
        status: "tracking",
      }));
    });
    await flush();

    await act(async () => {
      await latest.handleSaveAddApplication();
    });

    expect(sb.rows("applications")).toHaveLength(1);
    expect(sb.rows("applications")[0].status).toBe("tracking");
    expect(latest.addAppError).toBe("");
  });
});
