// THE SCOPE OF THE ACTIVITY LOG, AS DATA.
//
// ---------------------------------------------------------------------------
// WHY A REGISTRY AND NOT A COMMENT
// ---------------------------------------------------------------------------
// The owner asked for a log that "encompass[es] everything that has happened on
// the app in that session". A comment claiming that is a promise nothing can
// falsify, and a log that says "everything" while quietly missing whole
// subsystems is worse than one that states its scope honestly -- a reader
// cannot tell "nothing happened" from "this subsystem does not report".
//
// So the scope lives here, as data, and it is used TWICE:
//
//   * lib/activityLog/activityLogDocument.js prints it into the downloaded
//     file, both halves -- what is captured AND what is not, with the reason.
//   * lib/activityLog/activityCoverage.sweep.test.js walks the real tree and
//     fails if anything reaches the network or moves the page around the
//     capture points without being named below.
//
// Neither half can drift from the other without a red test, which is the only
// thing that turns "this captures everything" from a claim into a fact.
//
// Plain data, no imports, no logic: the sweep and the renderer are the only
// consumers and both want it inert.

// ---------------------------------------------------------------------------
// WHAT IS CAPTURED.
//
// `how` is the property that matters. A CHOKE POINT is one wrapper that every
// caller goes through whether it knows about the log or not, so a subsystem
// nobody thought about is captured anyway. A CALL SITE has to be remembered,
// so it can be forgotten -- and the registry says so, in the file, rather than
// letting a reader assume otherwise.
// ---------------------------------------------------------------------------
export const CAPTURED_CHANNELS = [
  {
    id: "net",
    how: "choke-point",
    label: "Network requests",
    what:
      "Every fetch() this browser tab issues once recording starts: the method, the path, the query parameter names, the response status, how long it took, and the error when a request fails outright.",
  },
  {
    id: "err",
    how: "choke-point",
    label: "Errors and warnings",
    what:
      "Every uncaught exception, every unhandled promise rejection, and every console.error and console.warn the page produces, with its message.",
  },
  {
    id: "nav",
    how: "choke-point",
    label: "Navigation inside the app",
    what:
      "Every in-app route change, by path: pushState and replaceState navigations, plus the browser Back and Forward buttons.",
  },
  {
    id: "act",
    how: "call-site",
    label: "Feature actions",
    what:
      "Actions a feature records about itself. This is the one channel that is not automatic: it depends on feature code calling recordActivity(), so a feature that never calls it contributes nothing here, and this file cannot tell you that it happened.",
  },
];

// ---------------------------------------------------------------------------
// WHAT IS NOT CAPTURED, AND WHY.
//
// `modules` names the real files responsible, so the coverage sweep can check
// this ledger against the tree instead of against prose. An entry with no
// `modules` is a category rather than a set of call sites (the server side, the
// gap before install); the sweep checks those separately.
// ---------------------------------------------------------------------------
export const UNCAPTURED_SURFACES = [
  {
    id: "before-install",
    modules: [],
    what: "Anything that happened before recording started in this tab",
    why: "Recording begins when the app's header mounts, which is the first client code to run; the exact instant is printed at the top of this file so a gap at the very start of the session is visible rather than implied away.",
  },
  {
    id: "server",
    modules: [],
    what: "Work that happens inside the app's own API routes on the server",
    why: "This log lives in the browser tab, so an API route contributes its request and its response status and nothing else. What the route did in between -- which model it called, which rows it read -- is not visible from here and is not in this file.",
  },
  {
    id: "stt-websocket",
    modules: ["lib/copilot/stt/deepgram.js", "lib/copilot/stt/elevenlabs.js"],
    what: "Live speech-to-text streams used by the interview copilot",
    why: "These run over a WebSocket rather than fetch, so they do not pass the capture point at all. That is also the right outcome on its own terms: the stream carries microphone audio and interview transcript, which do not belong in a file that gets attached to a support ticket.",
  },
  {
    id: "full-page-navigation",
    modules: ["app/components/AccountSection.js", "app/login/page.js"],
    what: "Sign-in and sign-out, which replace the whole page",
    why: "A full page load discards this log along with everything else in the tab, and the page that loads next starts an empty one. Nothing survives that boundary, so a session that spans a sign-in is two files, not one.",
  },
  {
    id: "new-window",
    modules: [
      "lib/window/openPostingBeside.js",
      "app/components/AutoApplyQueueTab.js",
      "app/components/LiveFeedTab.js",
      "app/hooks/useDriveDocuments.js",
      "app/page.js",
    ],
    what: "Anything that happens in a job posting tab or a Google sign-in popup this app opens",
    why: "A second window is a separate page with its own scripts, and this log can see only its own tab. The act of opening one can appear here; what the person then did over there cannot.",
  },
  {
    id: "input-and-content",
    modules: [],
    what: "Keystrokes, clicks, scrolling, form contents, and the text of a resume, cover letter or job posting",
    why: "None of this is recorded at any point. Capturing it would turn a diagnostic file into a transcript of the person using the app, and the file is downloadable and gets shared onward.",
  },
  {
    id: "across-tabs-and-reloads",
    modules: [],
    what: "Other browser tabs, earlier sessions, and anything after this tab is reloaded or closed",
    why: "The ledger is held in memory for the life of one tab and is never written to storage or sent anywhere. Reloading the page starts a new, empty one, which is deliberate: nothing accumulates on the machine without the person asking for it.",
  },
];

// ---------------------------------------------------------------------------
// THE FEATURE LOGS, AND WHETHER THEY FOLD IN.
//
// The standing rule in this repo gives every feature that can carry a log its
// own log and its own download button. The app-wide layer AGGREGATES those
// rather than re-implementing them: a feature calls attachActivitySection()
// once and its own markdown lands in this file verbatim. This ledger is what
// keeps the promise honest for the ones that have not been wired yet -- the
// coverage sweep matches it against the tree exactly, so a new feature log
// cannot quietly go missing from the app-wide file.
// ---------------------------------------------------------------------------
export const FEATURE_LOG_LEDGER = [
  {
    module: "lib/duplicateApply/duplicateApplyLogDocument.js",
    label: "Duplicate-application checks",
    attached: true,
  },
  {
    module: "lib/duplicateApply/duplicateApplyLog.js",
    label: "Duplicate-application check records",
    attached: true,
  },
  {
    module: "lib/copilot/sessionLog.js",
    label: "Interview copilot session",
    attached: false,
    why: "The copilot runs on its own route with its own session lifecycle, and its log is per-interview rather than per-tab: it starts and ends with a live session and already has its own download control beside the session it describes. Folding a half-finished interview into this file would give two different answers to when the session started.",
  },
  {
    module: "lib/copilot/sessionLogArchive.js",
    label: "Interview copilot session archive",
    attached: false,
    why: "The archive is a zip of one interview's recordings and transcripts, not markdown, so there is nothing for a markdown file to fold in; it is downloaded from the copilot page beside the session it belongs to.",
  },
  {
    module: "lib/experience/knowledgeLog.js",
    label: "Knowledge base scope summary",
    attached: false,
    why: "This log is rebuilt at download time from the stored summary and question rows rather than accumulated in memory, so producing it needs a live database read that a synchronous render of this file cannot perform. It stays on the knowledge panel, where the rows it describes are already loaded.",
  },
  {
    module: "lib/interviewPrep/prepLog.js",
    label: "Interview-prep activity ledger",
    attached: false,
    why: "createPrepLog is the ephemeral, per-tab counter behind interview-prep's own \"N events recorded\" caption and its own reset control -- it dies with the tab by design and never reads or writes interview_prep_packs, interview_prep_spend or interview_prep_events. The durable record this feature actually exposes for download is served from listPrepEvents in lib/interviewPrep/prepStore.js, so there is nothing in this module for a markdown file to fold in.",
  },
  {
    module: "lib/feed/autoTailorRunLog.js",
    label: "Auto-apply run log",
    attached: false,
    why: "The auto-tailor cron runs server-side with no user present, so its per-run outcome is summarized here and, once persisted, rebuilt into markdown at download time on the automation panel -- not accumulated in this per-tab in-memory activity log. Folding a headless run into this file would claim a session event that never happened in the tab.",
  },
];

// ---------------------------------------------------------------------------
// THE DECISION LEDGER, AND THE CLOSED OUTCOME VOCABULARY.
//
// A DIFFERENT registry from FEATURE_LOG_LEDGER above, for a different gap.
// FEATURE_LOG_LEDGER tracks whether a feature's OWN log folds into this file.
// This ledger tracks the thing the owner's top-priority incident actually
// hit: whether a feature that makes a user-visible DECISION -- act, or
// don't, and why -- reports that decision at all. The `act` channel above
// states its own blind spot in so many words: it "depends on feature code
// calling recordActivity(), so a feature that never calls it contributes
// nothing here, and this file cannot tell you that it happened." A decision
// that stops before its first network call leaves nothing in ANY automatic
// channel, so nothing but an explicit obligation closes that hole.
//
// Cross-checked against a derived scan of every real `recordDecision(` call
// site (lib/activityLog/decisionCoverage.sweep.test.js), `toEqual` in both
// directions -- the exact FEATURE_LOG_LEDGER idiom, for the exact same
// reason: a hand list alone goes stale, a derived scan alone cannot carry a
// human label or say why a feature reports the way it does.
//
// `fields` is the CLOSED field vocabulary lib/activityLog/appActivityLog.js's
// recordDecision() enforces: only a name listed here survives onto the
// record, and an id this ledger does not recognize keeps nothing at all --
// fail closed, not fail open, because this file is downloaded and shared
// onward. `outcomes` is drawn from DECISION_OUTCOMES below and MUST include
// at least one value other than "acted": an entry that can only ever report
// success reopens the exact hole the owner hit.
// ---------------------------------------------------------------------------

// The closed outcome vocabulary every recordDecision() call is normalized
// into. "unknown" is the fallback recordDecision() itself substitutes for an
// outcome no caller declared -- listed here, rather than left as a bare
// string buried in that module, so the vocabulary a reader can audit and the
// vocabulary the code actually enforces are the same array.
export const DECISION_OUTCOMES = ["acted", "skipped", "refused", "failed", "unknown"];

export const DECISION_LEDGER = [
  {
    module: "app/hooks/useDuplicateApplyCheck.js",
    id: "duplicate-check",
    label: "Duplicate-application check decisions",
    fields: ["reason", "count", "entryPoint", "kind"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "app/components/DocumentPreviewMount.js",
    id: "fact-auto-insert",
    label: "Auto-inserted company facts",
    // A canned reason, the real inserted count, and the machine discriminator
    // (`code`) the refusal actually returned -- never the fact text, the
    // company, the article title or a byte of the letter itself (N77).
    // N90: the nothing-eligible eligibility breakdown -- plain counts only,
    // never a url, id, title or suggestion string.
    fields: [
      "reason",
      "count",
      "code",
      "articleCount",
      "droppedNoUrl",
      "droppedNoSuggestion",
      "droppedRemoved",
      "droppedRemovedAlsoAccepted",
    ],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "lib/chat/salaryEstimateRequest.js",
    id: "salary-estimate",
    label: "Salary estimate decisions",
    // A canned reason code, the surviving citation count, and the basis
    // discriminator -- never the estimated number, the company name, a
    // citation URL or a citation title (same N77 privacy precedent).
    fields: ["reason", "citationCount", "basisKind"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "app/hooks/useCompanyResearch.js",
    id: "fact-position",
    label: "Fact positioning (move / forward-nudge)",
    // N92 Wave 1: Control A's manual move AND (Wave 2) Control C's insert-time
    // forward nudge both record here -- the sweep binds one ledger entry per
    // MODULE, and both features record from this same file, so they cannot
    // have separate entries (design N92.design-structure.r1.md section 5).
    // `direction` is the move's own discriminator (forward/backward);
    // `reason`/`code` are canned enums off planMoveFact's own closed reason
    // set ("ok"/"boundary"/"stale-locator"/"not-found"); `count` is reserved
    // for Wave 2's per-insertion affected-fact count. Never the letter text,
    // the company, a url or an article title (N77).
    fields: ["direction", "reason", "code", "count"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "lib/coverFacts/smoothTransition.js",
    id: "fact-smooth",
    label: "Cover-fact transition smoothing",
    // N92 Wave 3: Control B records from its OWN module -- the sweep binds
    // one ledger entry per module, and putting the smoothing call and its
    // recordDecision( together here is also what AC-B8a's own-module
    // structure is for. `reason`/`code` are canned discriminators off the
    // module's own closed outcome set ("smoothed"/"declined"/"scope"/
    // "added-token"/"stale-locator"/"provider_error"/"embedded"). Never the
    // letter text, the fact text, or the before/after wording (N77).
    fields: ["reason", "code"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "lib/tailor/tailorLevelRequest.js",
    id: "n105-ideal-run",
    label: "Ideal-level generation requests",
    // N105 Step 6: the client records the moment an Ideal generation is
    // requested ("acted") and the moment a stale Ideal selection is turned back
    // into a standard run because the dark-launch gate is off ("skipped").
    // `reason` is a canned code ("ideal-requested" / "gate-off"), `engine` the
    // engine's code name and `level` "ideal" / "standard". Never the resume,
    // the posting, a file name, a company or a title (N77).
    fields: ["reason", "engine", "level"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "app/hooks/useRegenerateWeaknesses.js",
    id: "weakness-regenerate",
    label: "Regenerate-to-address-weaknesses decisions",
    // N104: a regenerate that replaced the text or left it the same ("acted"), a
    // run that could not finish ("failed"), an activation the row refused because
    // the state was not ready ("refused"), and an Undo ("acted"). `reason` is a
    // canned code (regenerated / unchanged / undone / failed, or the unavailable
    // state's own name), `engine` the engine's code name, and the rest are plain
    // counts or a boolean. Never the resume, a requirement or keyword, a label, a
    // company or a title (N77).
    fields: [
      "reason",
      "engine",
      "suggestionsBefore",
      "suggestionsAfter",
      "newlyFlagged",
      "unqualifiedCount",
      "confirmCount",
      "coverageComplete",
    ],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
  {
    module: "app/components/preview/DocumentReviewSection.js",
    id: "document-review",
    label: "Adversarial-review button decisions",
    // N113 (N103 UX 8.4): one record per activation of the review control, from the
    // section both surfaces share (the preview modal and the Ask-AI chat). A review
    // that ran ("acted"), an empty document ("refused"), a tab the band above already
    // covers ("skipped") and a run that could not finish ("failed"). `surface` and
    // `scope` are whitelisted codes, `kind` the verdict kind or the state's own name,
    // `reason` a canned code, `engineMode` the reviewer's code name, and the rest are
    // plain counts or a boolean. Never the title, a company, an excerpt, a flag's
    // message or a line of the resume (N77).
    fields: ["surface", "scope", "kind", "reason", "flagCount", "lineCount", "engineMode", "coverageComplete"],
    outcomes: ["acted", "skipped", "refused", "failed"],
  },
];
