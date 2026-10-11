// N157 SC-C: the ONLY browser-Supabase file in the study-plan feature. It binds
// the browser client to the progress store's two injected seams for one
// application: a `reader` (shaped like readStudyPlan's return, for
// loadStudyPlanRecord) and a `writer` (`({ cursor, seenDelta }) => { written,
// error }`, for recordProgress). Sibling features reach Supabase through
// lib/*Client.js wrappers like this one, not from components.
//
// NOTHING RUNS AT IMPORT (design r2 section 5.6, the F-3 hard gate). Seven
// CopilotClient suites mock the practice client and, after the PracticeSurface
// mount, load this module's whole import graph without ever rendering the Study
// view. `createClient()` calls createBrowserClient(env...), which can throw when
// the NEXT_PUBLIC_SUPABASE_* variables are absent, so the call lives only inside
// the binding's functions, on first use, and is memoised per binding. A top-level
// `import { createClient }` is fine (a plain function export); the CALL is what
// must stay lazy. Binding an application is itself free.
//
// IDENTITY. The reader scopes its query to the signed-in user, resolved by ONE
// auth.getUser() per binding (a network round trip, so never per call), memoised
// as a promise and cleared on failure or a signed-out answer so a transient error
// or a later sign-in is retried instead of cached. The writer calls getUser ZERO
// times: the progress RPC takes no user id, identity is auth.uid() inside it.
//
// NEVER REJECTS. A throwing client, a failed auth call or a signed-out user
// settles as an ERROR RECORD (every data field null, `error` a message), the
// shape the store already settles on, rather than a rejection that would blow up
// a mount.

import { createClient } from "@/lib/supabase/client";
import { readStudyPlan, writeStudyPlanProgress } from "./studyPlanStore.js";

const UNREACHABLE = "Could not reach your study plan.";
const SIGNED_OUT = "Sign in to see your study plan.";
const SAVE_FAILED = "Could not save your progress.";

function messageOf(err, fallback) {
  return typeof err?.message === "string" && err.message !== "" ? err.message : fallback;
}

// A read that produced nothing to show, with the reason. The same all-null shape
// readStudyPlan returns for a failed read.
function errorRecord(error) {
  return {
    status: null,
    plan: null,
    knobs: null,
    progress: null,
    cachedResearch: null,
    postingFingerprint: null,
    researchedAt: null,
    engine: null,
    error,
  };
}

/**
 * Binds the reader and the writer to one application.
 *
 * @param {string} applicationId
 * @returns {{
 *   reader: () => Promise<object>,
 *   writer: (args: { cursor: object, seenDelta: object }) => Promise<{ written: boolean, error: string | null }>,
 * }}
 */
export function bindStudyPlan(applicationId) {
  let client = null;
  let userIdPromise = null;

  const getClient = () => {
    if (client === null) client = createClient();
    return client;
  };

  const fetchUserId = async () => {
    const { data, error } = await getClient().auth.getUser();
    return error || !data?.user?.id ? null : data.user.id;
  };

  const resolveUserId = () => {
    if (userIdPromise === null) {
      const pending = fetchUserId();
      userIdPromise = pending;
      const forget = () => {
        if (userIdPromise === pending) userIdPromise = null;
      };
      pending.then((id) => (id ? undefined : forget()), forget);
    }
    return userIdPromise;
  };

  const reader = async () => {
    try {
      const userId = await resolveUserId();
      if (!userId) return errorRecord(SIGNED_OUT);
      return await readStudyPlan(getClient(), { applicationId, userId });
    } catch (err) {
      return errorRecord(messageOf(err, UNREACHABLE));
    }
  };

  const writer = async ({ cursor, seenDelta } = {}) => {
    try {
      return await writeStudyPlanProgress(getClient(), { applicationId, cursor, seenDelta });
    } catch (err) {
      return { written: false, error: messageOf(err, SAVE_FAILED) };
    }
  };

  return { reader, writer };
}
