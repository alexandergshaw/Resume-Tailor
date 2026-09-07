// @vitest-environment jsdom
//
// The composition test for the chip untrack: two separately-correct halves
// (`untrackChipApplication`'s row verdict and `presentUntrackOutcome`'s copy)
// wired to the dock. The defect this file exists for was ENTIRELY in the
// wiring — both halves of the old code were fine, and the `if (refused)
// return;` between them is what made "Remove" do nothing — so a pure unit
// test of either half could never have caught it.
//
// createRoot + act, no @testing-library (this repo has none) — same idiom as
// app/copilot/useCopilotDashboard.wiring.test.js and StatusBar.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { createClient } from "@/lib/supabase/client";
import { untrackChipApplication } from "@/lib/applications/untrackChip";
import { useUntrackChip } from "./useUntrackChip.js";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

// The REAL implementation by default — these are wiring tests against the
// genuine article, not against a story about it — wrapped in a spy so the one
// test that needs to control resolution TIMING can take it over.
vi.mock("@/lib/applications/untrackChip", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, untrackChipApplication: vi.fn(orig.untrackChipApplication) };
});

const REAL = await vi.importActual("@/lib/applications/untrackChip");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: "user-1" };
const EXTERNAL_ID = "gh-1";
const POSITION_ID = "pos-1";
const APPLIED_AT = "2026-07-04T15:32:11.000Z";
const CHIP = { id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" };
const OTHER_CHIP = { id: "gh-2", title: "Staff Engineer", company: "Globex" };

let container;
let root;

function seedSupabase(status, appliedAt) {
  return makeStatefulSupabase(
    {
      applications:
        status === null
          ? []
          : [
              {
                id: "app-1",
                user_id: USER.id,
                position_id: POSITION_ID,
                status,
                applied_at: appliedAt,
              },
            ],
      positions: [
        { id: POSITION_ID, external_id: EXTERNAL_ID, title: "Senior Engineer", company: "Acme" },
      ],
    },
    { user: USER },
  );
}

function Host({ currentUser, initialJobs, setTrackedJobsOverride, out }) {
  const [trackedJobs, setTrackedJobs] = useState(initialJobs);
  const api = useUntrackChip({
    currentUser,
    trackedJobs,
    setTrackedJobs: setTrackedJobsOverride || setTrackedJobs,
  });
  out.current = { ...api, trackedJobs };
  return null;
}

async function mount(props) {
  const out = { current: null };
  await act(async () => {
    root.render(createElement(Host, { ...props, out }));
  });
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  untrackChipApplication.mockImplementation(REAL.untrackChipApplication);
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

describe("useUntrackChip — the chip always goes", () => {
  it("drops the chip for an APPLIED job — the reported bug — and keeps the row", async () => {
    const sb = seedSupabase("applied", APPLIED_AT);
    createClient.mockReturnValue(sb);
    const out = await mount({ currentUser: USER, initialJobs: [CHIP, OTHER_CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([OTHER_CHIP]);
    const row = sb.row("applications", (r) => r.id === "app-1");
    expect(row).not.toBeNull();
    expect(row.applied_at).toBe(APPLIED_AT);
  });

  it("explains the refusal instead of swallowing it", async () => {
    createClient.mockReturnValue(seedSupabase("applied", APPLIED_AT));
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.untrackNotice).not.toBeNull();
    expect(out.current.untrackNotice.tone).toBe("info");
    expect(out.current.untrackNotice.jobId).toBe(EXTERNAL_ID);
    expect(out.current.untrackNotice.sentence).toContain("Tracking");
    expect(out.current.untrackAnnounceSeq).toBe(1);
  });

  it("drops the chip for a `tailored` job too", async () => {
    createClient.mockReturnValue(seedSupabase("tailored", null));
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([]);
    expect(out.current.untrackNotice.tone).toBe("info");
  });

  it("drops the chip when there is no application row at all, and says nothing", async () => {
    createClient.mockReturnValue(seedSupabase(null, null));
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([]);
    expect(out.current.untrackNotice).toBeNull();
  });

  it("warns, and offers no Tracking link, for a status Tracking will not list", async () => {
    createClient.mockReturnValue(seedSupabase("auto_tailored", null));
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([]);
    expect(out.current.untrackNotice.tone).toBe("warning");
    expect(out.current.untrackNotice.searchSeed).toBe("");
  });

  it("stays silent on a real delete — the chip going IS the confirmation", async () => {
    const sb = seedSupabase("tracking", null);
    createClient.mockReturnValue(sb);
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([]);
    expect(out.current.untrackNotice).toBeNull();
    expect(out.current.untrackAnnounceSeq).toBe(0);
    expect(sb.row("applications", (r) => r.id === "app-1")).toBeNull();
  });

  it("signed out: drops the chip, queries nothing, reports nothing", async () => {
    const out = await mount({ currentUser: null, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.trackedJobs).toEqual([]);
    expect(out.current.untrackNotice).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(untrackChipApplication).not.toHaveBeenCalled();
  });

  it("re-announces an identical notice — the counter, not the text, is what changes", async () => {
    createClient.mockReturnValue(seedSupabase("applied", APPLIED_AT));
    // A spy setter, so `trackedJobs` never changes and the SECOND call sees
    // exactly the same chip as the first: identical copy, two announcements.
    const out = await mount({
      currentUser: USER,
      initialJobs: [CHIP],
      setTrackedJobsOverride: vi.fn(),
    });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });
    const first = out.current.untrackNotice.announcement;
    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });

    expect(out.current.untrackNotice.announcement).toBe(first);
    expect(out.current.untrackAnnounceSeq).toBe(2);
  });

  it("dismissUntrackNotice clears the notice and nothing else", async () => {
    createClient.mockReturnValue(seedSupabase("applied", APPLIED_AT));
    const out = await mount({ currentUser: USER, initialJobs: [CHIP] });

    await act(async () => {
      await out.current.handleUntrackJob(EXTERNAL_ID);
    });
    expect(out.current.untrackNotice).not.toBeNull();

    await act(async () => {
      out.current.dismissUntrackNotice();
    });
    expect(out.current.untrackNotice).toBeNull();
    expect(out.current.trackedJobs).toEqual([]);
  });
});

describe("useUntrackChip — ordering", () => {
  it("does not drop the chip until the row's fate is known", async () => {
    let resolveOutcome;
    untrackChipApplication.mockReturnValue(
      new Promise((resolve) => {
        resolveOutcome = resolve;
      }),
    );
    createClient.mockReturnValue(seedSupabase("applied", APPLIED_AT));
    const setTrackedJobs = vi.fn();
    const out = await mount({
      currentUser: USER,
      initialJobs: [CHIP],
      setTrackedJobsOverride: setTrackedJobs,
    });

    let settled = false;
    await act(async () => {
      out.current.handleUntrackJob(EXTERNAL_ID).then(() => {
        settled = true;
      });
    });

    // The removal and its explanation must land in the SAME render, so the
    // chip is still there while the query is outstanding.
    expect(setTrackedJobs).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(out.current.untrackNotice).toBeNull();

    await act(async () => {
      resolveOutcome({
        deleted: false,
        kept: { status: "applied", appliedAt: APPLIED_AT },
        unknown: false,
      });
      await Promise.resolve();
    });

    expect(setTrackedJobs).toHaveBeenCalledTimes(1);
    expect(out.current.untrackNotice).not.toBeNull();
  });
});
