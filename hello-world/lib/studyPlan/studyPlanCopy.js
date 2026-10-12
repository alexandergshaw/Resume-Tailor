// The pinned user-facing copy for the study plan (N157 SC-C), in one
// reviewable place. Every string here is a design-pinned string: changing one
// is a ruling, not an edit, because the later UI waves and their tests render
// it verbatim. No em dashes (a screen reader does not speak them at default
// punctuation) and no emoji.
//
// TEMPLATES ARE RAW STRINGS. Plan-specific copy keeps its `<slot>` markers
// (`<title>`, `<company>`, `<error>`, `<i>`, `<n>`, `<done>`, `<total>`,
// `<relative>`) as literal text, so no company, role, count or error message is
// ever baked in here: the caller fills the slot from live data. Fill a slot
// with a replacer FUNCTION (`text.replace("<company>", () => company)`), never
// a replacement string, which would give "$&" in the data a special meaning.
//
// Pure data: no imports, no functions, no IO.

function freezeDeep(group) {
  for (const value of Object.values(group)) {
    if (value !== null && typeof value === "object") freezeDeep(value);
  }
  return Object.freeze(group);
}

export const STUDY_COPY = freezeDeep({
  // Practice tool navigation and the view heading.
  nav: {
    groupLabel: "Practice tool",
    answerAloud: "Answer aloud",
    studyPlan: "Study plan",
    viewHeading: "Study plan",
  },

  // Application picker and the create step.
  picker: {
    label: "Study plan for",
    hint: "Pick a tracked application to build a study plan.",
    emptyAccount: "No tracked postings yet. Add one from the Tracking tab.",
    disabledCreateReason: "Pick a tracked application first. The plan is built from that company's research.",
    intro:
      "Build a study plan for <title> at <company>: questions and answers drawn from web research on the company, the role and the interview process, worked through one card at a time. Your progress is saved to your account, so you can pick up on any device.",
    createButton: "Create study plan",
  },

  // What the engine choice sends where, shown before a plan is created.
  notice: {
    gemini:
      "Creating a plan searches the web for this company. Its name, the job title, the location and the posting text are sent to Google (Gemini) to research it, and that research is sent to Gemini again to write the plan. Your resume and cover letter are not sent. The plan and your progress are saved to your account. Any focus or skip choices you set are sent to Gemini with it.",
    embedded:
      "The embedded engine is on, so nothing is sent to an AI provider. It can only use company research you already have saved.",
  },

  // The two build steps and the status line that walks through them.
  build: {
    stepResearch: "Researching the company and the interview process",
    stepWrite: "Writing your plan",
    statusResearching: "Researching <company>. This can take a minute or two.",
    statusWriting: "Writing your plan...",
    statusReady: "Your plan is ready.",
  },

  // Failure and remedy copy.
  failure: {
    loadFailed: "Couldn't load your study plan: <error>",
    researchFailed: "We couldn't research this company: <error>",
    unavailable: "The plan could not be built.",
    switchedOff: "Study plans are switched off right now.",
    rebuildFailedKept: "We couldn't rebuild your plan. Your previous plan is unchanged.",
    embeddedNeedsResearch:
      "The embedded engine can't research a company. Switch the engine in the top bar to Gemini, then try again.",
    tryAgain: "Try again",
    generalPlanOption: "Build a general plan without research",
    generalPlanCaption: "A general plan is not based on sources about this company. It will be marked as unsourced.",
  },

  // The card screen: hint, actions, chips, position, revisit.
  card: {
    hint: "Answer it out loud or in your head, then show the answer.",
    showAnswer: "Show answer",
    gotIt: "Got it",
    missedIt: "Missed it",
    next: "Next",
    previous: "Previous card",
    outline: "Plan outline",
    chipNew: "New",
    chipReview: "Review",
    chipNoSource: "No source",
    chipUnsourced: "Unsourced",
    position: "Card <i> of <n> in this topic",
    progress: "<done> of <total> done",
    secondPass: "Going back over cards you missed or skipped",
    revisitGotIt: "You marked this: Got it",
    revisitMissedIt: "You marked this: Missed it",
  },

  // The end of the plan.
  complete: {
    heading: "All cards done",
    body: "You've been through all <total> cards.",
    reviewAll: "Review all again",
  },

  // A progress write that did not reach the server.
  save: {
    failed: "Your last answer wasn't saved. It's kept on this device for now.",
    retry: "Retry saving",
  },

  // Sources under a card and the research freshness line.
  sources: {
    showAll: "Show all sources (<n>)",
    linkUnavailable: "source link unavailable",
    researchLine: "Based on research from <relative>.",
  },

  // Provenance banners.
  banner: {
    general: "This is a general plan. It is not based on research about this company.",
    unsourced: "Research for this company found no sources you can open, so this plan is unsourced.",
    embedded: "Built offline from your saved research, without AI. Cards are excerpts, not written questions.",
  },

  // Remedy buttons and the armed-rebuild confirmation.
  remedy: {
    researchAndRebuild: "Research and rebuild",
    refreshResearch: "Refresh research",
    rebuildPlan: "Rebuild plan",
    confirmRebuild: "Confirm rebuild?",
    switchEngine: "Switch the engine in the top bar to Gemini, then rebuild.",
    armedAnnouncement:
      "Rebuilding writes new cards, so most of your progress on this plan will not carry over. Activate again to confirm.",
  },

  // The customization controls (N157 SC-D): the disclosure labels, the three
  // controls, the closed-panel summary pieces and the per-engine captions.
  // `<max>` is the day cap, filled by the caller from MAX_PLAN_DAYS so a retuned
  // cap never leaves a stale number in the copy.
  knobs: {
    disclosureCreate: "Customize your plan",
    disclosureOutline: "Plan settings",
    summaryDays: "<n> days",
    summaryOneDay: "1 day",
    summaryCustomMix: "Custom mix",
    summaryAllAreas: "All areas",
    summaryAreas: "<focus> focus, <skipped> skipped",
    daysLegend: "Days until your interview",
    daysHelper: "Between 1 and <max>. Sizes the plan to fit.",
    daysError: "Enter a whole number from 1 to <max>.",
    mixLegend: "Mix of new and review cards",
    mixMostlyNew: "Mostly new",
    mixEven: "Even mix",
    mixMostlyReview: "Mostly review",
    mixCaption: "About <new> percent new and <review> percent review.",
    mixCustomCaption: "Custom mix: <new> percent new.",
    areasLegend: "Areas",
    areasHelper: "Focus adds extra cards on an area. Skip leaves it out.",
    focus: "Focus",
    skip: "Skip",
    lastIncludedReason: "At least one area stays included.",
    suggestion: "You missed cards in: <list>.",
    suggestionButton: "Focus on these",
    dirtyNote: "Settings changed. Rebuild the plan to apply them.",
    embeddedCaption:
      "The embedded engine ignores focus areas and the number of days. It does use the mix and skipped areas.",
    geminiCaption: "Gemini is asked to follow these; the result can vary.",
  },
});
