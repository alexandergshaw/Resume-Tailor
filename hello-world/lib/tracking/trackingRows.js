import { normalizeInterviewValue } from "./stages";

// The tracking surface's derived row data, pulled out of app/page.js so the
// page can memoize each one on exactly the inputs it reads. Before this, all
// three were rebuilt on every render of the page component, and a rebuilt
// array or object is a fresh identity that defeats every React.memo below it
// (see app/components/tracking/ApplicationCard.js and ApplicationRow.js). Pure
// functions: no React, no I/O.

// The rows the tracking table / card list shows: the company-or-role search
// filter, then the active sort. `sort` is { field, dir } as the page holds it
// (field null = fetch order). Always returns a NEW array, never `applicationData`
// itself, so a caller can hand it straight to a memoized child.
export function selectVisibleApplications(applicationData, search, sort) {
  const query = normalizeInterviewValue(search);
  return [...applicationData]
    .filter((app) => {
      if (!query) return true;
      const company = normalizeInterviewValue(app.positions?.company);
      const role = normalizeInterviewValue(app.positions?.title);
      return company.includes(query) || role.includes(query);
    })
    .sort((a, b) => {
      if (!sort.field) return 0;
      const field = sort.field;
      let av;
      let bv;
      if (field === "company" || field === "title") {
        av = (a.positions?.[field] || "").toString().toLowerCase();
        bv = (b.positions?.[field] || "").toString().toLowerCase();
      } else if (field === "status") {
        av = (a.status || "").toString().toLowerCase();
        bv = (b.status || "").toString().toLowerCase();
      } else if (field === "applied_at") {
        // Date sort: empty dates always sort to the bottom.
        av = a.applied_at ? new Date(a.applied_at).getTime() : NaN;
        bv = b.applied_at ? new Date(b.applied_at).getTime() : NaN;
        const aMissing = Number.isNaN(av);
        const bMissing = Number.isNaN(bv);
        if (aMissing && !bMissing) return 1;
        if (!aMissing && bMissing) return -1;
        if (aMissing && bMissing) return 0;
        return sort.dir === "asc" ? av - bv : bv - av;
      } else {
        return 0;
      }
      // Empty string values sort to the end regardless of direction.
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      const cmp = av.localeCompare(bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
}

// A rejection outranks an interview invite, which outranks a bare
// confirmation: one application can match several emails, and the table pill
// shows the most consequential one.
const CLASSIFICATION_PRIORITY = { rejection: 3, interview: 2, confirmation: 1 };

// application id -> the highest-priority email classification among the Gmail
// messages matched to that application. Messages with no matched application
// or no classification are skipped.
export function classificationsByAppId(gmailMessages) {
  return gmailMessages.reduce((acc, { application, classification }) => {
    if (!application?.id || !classification) return acc;
    const existing = acc[application.id];
    if (!existing || CLASSIFICATION_PRIORITY[classification] > CLASSIFICATION_PRIORITY[existing]) {
      acc[application.id] = classification;
    }
    return acc;
  }, {});
}

// application id -> index in `applicationData`, built once so a per-row lookup
// is O(1) instead of a findIndex scan inside the row loop. A duplicate id
// keeps its FIRST index, which is what the findIndex it replaces returned.
export function indexApplicationsById(applicationData) {
  const index = new Map();
  applicationData.forEach((app, i) => {
    if (!index.has(app.id)) index.set(app.id, i);
  });
  return index;
}
