import { classifyStatus } from "./statusVocabulary.js";

// Three PURE decisions extracted out of `app/page.js` and
// `app/hooks/useApplicationDialogs.js` (AC-11) so they are reachable without
// mounting the 3200-line client component they came from. None of the three
// touches Supabase, the DOM, or `window` — every branch is a function of its
// arguments alone.

/**
 * Decides what clicking the "Mark as applied" toggle should do for one job,
 * given the applied-or-later map the loader built. The map is keyed by
 * external id and holds `{status, appliedAt, applicationId}` for every row
 * that is EITHER applied-or-later by status OR carries a non-null
 * `applied_at` (the D1-victim disjunct) — see
 * `loadAppliedOrLaterExternalIds`.
 *
 * The branch is chosen from the row's STATUS, never from `appliedAt`. A
 * `tracking` row that still carries a stranded date (a D1 victim) is IN the
 * map — its badge reads applied, which is the widening's deliberate visible
 * consequence — but it must stay promotable, because promoting it cannot
 * fabricate a date: the writer's stamp is guarded by `applied_at IS NULL`
 * and finds a value already there.
 *
 * "the map has not loaded" (`null`/`undefined`) is deliberately distinct from
 * "loaded, and holds no row for this job" (`"apply"`): collapsing them would
 * let a click during load write a row the user never asked for.
 *
 * @param {Map<string,{status:string}>|null|undefined} appliedByExternalId
 * @param {string} jobId  external id
 * @returns {"apply"|"open-tracking"|"refuse-unknown"}
 */
export function selectAppliedToggleAction(appliedByExternalId, jobId) {
  if (!appliedByExternalId) return "refuse-unknown";
  if (!appliedByExternalId.has(jobId)) return "apply";

  const entry = appliedByExternalId.get(jobId);
  const classification = classifyStatus(entry?.status);
  if (classification === "pre-apply") return "apply";
  if (classification === "applied-or-later") return "open-tracking";
  // A status outside the eleven. The UI-side complement of the writer's
  // fail-closed allow-list: a twelfth status added to the live CHECK by a
  // future integration must not produce a confident click in either layer.
  return "refuse-unknown";
}

// `openEditApplicationDialog` fills the date field with
// `new Date(app.applied_at).toISOString().slice(0, 10)` — a UTC date-only
// string. Comparing against that SAME derivation (rather than, say, a local-
// time one) is what stops a save that touched nothing but the URL from
// silently moving the stored date: a value late enough in the UTC day that a
// naive local-time comparison would call it "a different date" must still
// read as unchanged here.
function storedDateOnly(storedAppliedAt) {
  if (storedAppliedAt === null || storedAppliedAt === undefined) return null;
  return new Date(storedAppliedAt).toISOString().slice(0, 10);
}

/**
 * Builds the UPDATE payload for the Edit dialog's save, and reports whether
 * doing so would destroy a real, non-NULL `applied_at` — the fact
 * `buildStatusChangeConfirmation` needs in order to ask, and the caller needs
 * in order to know whether it owes the user a confirmation at all.
 *
 * `applied_at` is named in the payload ONLY when the date field's value
 * actually differs from the stored date (AC-8b). Today's inline literal
 * names it on EVERY save, so saving after editing only the URL rewrites the
 * column via a UTC round-trip that can move the DISPLAYED date by a day —
 * this is the fix for that, not a generalisation of it.
 *
 * @param {object} args
 * @param {{status:string, appliedAt:string, applicationUrl:string}} args.form
 *   `appliedAt` is the date-only string ("" when the field is empty) the
 *   dialog's `TextField` currently holds.
 * @param {string|null} args.storedAppliedAt  the ISO datetime this row had
 *   when the dialog was opened (the CAS operand elsewhere; here, the
 *   baseline for "did the date change").
 * @returns {{payload: object, destroysDate: boolean, clearsAppliedAt: boolean}}
 */
export function buildEditApplicationPayload({ form, storedAppliedAt }) {
  const trimmedUrl = (form.applicationUrl || "").trim();
  const payload = {
    status: form.status,
    application_url: trimmedUrl === "" ? null : trimmedUrl,
  };

  const typedDate = form.appliedAt ?? "";
  const hadStoredDate = storedAppliedAt !== null && storedAppliedAt !== undefined;
  let destroysDate = false;
  let clearsAppliedAt = false;

  if (typedDate === "") {
    // The field is empty. Only a write — and only a destructive one — if
    // there was a stored date to clear. A dateless row saved with an empty
    // field touches nothing: naming `applied_at: null` here would be the
    // exact defect this builder exists to stop, on the most common row shape
    // in the table.
    if (hadStoredDate) {
      payload.applied_at = null;
      clearsAppliedAt = true;
      destroysDate = true;
    }
  } else if (typedDate !== storedDateOnly(storedAppliedAt)) {
    payload.applied_at = new Date(typedDate).toISOString();
    // Destructive only when a REAL date is being overwritten. Adding a date
    // to a previously dateless row loses nothing.
    destroysDate = hadStoredDate;
  }
  // else: the typed date-only string matches the stored date under the same
  // UTC derivation the dialog populated it with — unchanged, name nothing.

  return { payload, destroysDate, clearsAppliedAt };
}

/**
 * The confirmation sentence for a save that would clear or overwrite a real
 * `applied_at` (AC-2a). Names the date in the same human format the pipeline
 * already shows the user (`TrackingTab.js`'s own `toLocaleDateString` call),
 * never the raw ISO timestamp — the raw string is developer-shaped, and this
 * dialog is the one place a user is asked to reason about losing it.
 *
 * @param {object} args
 * @param {string} args.company
 * @param {string} args.role
 * @param {string} args.appliedAtIso  the date being destroyed, as stored
 * @param {string} [args.locale]
 * @returns {string}
 */
export function buildStatusChangeConfirmation({ company, role, appliedAtIso, locale }) {
  const shownDate = new Date(appliedAtIso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const trimmedCompany = (company || "").trim();
  const trimmedRole = (role || "").trim();
  const label = trimmedCompany
    ? trimmedRole
      ? `${trimmedCompany} — ${trimmedRole}`
      : trimmedCompany
    : "this application";

  return `Clear the applied date of ${shownDate} for ${label}? This can't be undone.`;
}
