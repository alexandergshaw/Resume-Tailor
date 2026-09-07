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
];
