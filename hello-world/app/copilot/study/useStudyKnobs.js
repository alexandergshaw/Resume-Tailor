"use client";

import { useState } from "react";
import { knobsEqual } from "@/lib/studyPlan/studyPlanKnobs";
import { normalizeKnobs } from "@/lib/studyPlan/studyPlanSchema";

// N157 SC-D (design sections 3.7 and 3.9): the per-application DRAFT of the four
// study-plan knobs. There is no knobs-only write path (the stored knobs change
// only as part of a build), so an edit made in the panel is session state held
// here until the next build sends it.
//
//   effective  what a build sends: the draft when one is valid, else the stored
//              knobs, else the schema defaults. ALWAYS an object, never
//              undefined, and always a fresh normalizeKnobs clone.
//   dirty      the draft differs from the stored knobs (a change is waiting for
//              an explicit rebuild; nothing here ever starts one).
//   setKnobs   replaces the draft with the knobs the D-a model produced.
//
// ONE SLOT, KEYED TWICE. The draft remembers the application AND the stored
// knobs it was edited against. It is dropped the render it stops matching either:
// switching application drops it (a wrong-company plan is the failure this
// prevents), and a successful rebuild changes the stored knobs, so the draft
// retires itself. A failed or preserved rebuild writes nothing, the stored knobs
// do not move, and the draft is kept so "Try again" sends what the learner set.
// No effect is used: the draft is dropped by setting state during render, the
// same shape useStudyPlanRecord uses, so a Strict Mode double render is safe.

export default function useStudyKnobs(applicationId, storedKnobs) {
  const base = normalizeKnobs(storedKnobs);
  const baseKey = JSON.stringify(base);
  const [draft, setDraft] = useState(null);

  const live = draft !== null && draft.applicationId === applicationId && draft.baseKey === baseKey;
  if (draft !== null && !live) setDraft(null);

  const knobs = live ? draft.knobs : base;
  const setKnobs = (next) => {
    if (applicationId === "") return;
    setDraft({ applicationId, baseKey, knobs: normalizeKnobs(next) });
  };

  return { effective: knobs, dirty: live && !knobsEqual(knobs, base), setKnobs };
}
