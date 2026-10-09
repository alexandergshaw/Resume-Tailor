"use client";

import { useCallback } from "react";
import VoiceCueSidebar from "./VoiceCueSidebar";
import CompanyBriefPanel from "./CompanyBriefPanel";

// Headroom extraction, NOT a feature: split out of CopilotClient.js purely to
// keep that file under CopilotClient.extraction.test.js's 950-line cap, the
// same reason SessionControls.js, SpeakerBar.js and TranscriptDisclosure.js
// were themselves split out of it. The ternary and the cue handler below moved
// VERBATIM, comments included; nothing about what reaches the screen changed
// on the way out.
//
// Owns the live rail's CONTENT and nothing else: which of the two panels takes
// the rail's slot, and what a voice-cue activation does. CopilotClient keeps
// `railCollapsed` / `onToggleRailCollapsed` (the render-phase auto-collapse
// idiom stays where copilotHeadingOrder.test.js documents it) and both
// placement sites (the md+ rail Box and the below-md Box).
export default function LiveRail({
  companyBrief,
  collapsed,
  onToggleCollapsed,
  isEmbedded,
  hasCompany,
  speakerAttribution,
  speakerSnapshot,
}) {
  // N18 delta review F1: the "pin"/"unpin" branches this handler used to
  // carry (and the I10 comment explaining why a hold click never called
  // announceCue) are retired along with the hold cue itself — "company" is
  // the only action VOICE_CUES still recognizes (voiceCues.js).
  const onCueActivate = useCallback(
    (action) => {
      if (action === "company") companyBrief.openBrief();
    },
    [companyBrief],
  );

  // I11: the brief panel takes over the rail's slot rather than opening beside it (no room for both — I1).
  return companyBrief.open ? (
    <CompanyBriefPanel
      status={companyBrief.status}
      articles={companyBrief.articles}
      warnings={companyBrief.warnings}
      error={companyBrief.error}
      company={companyBrief.company}
      onRefresh={companyBrief.refresh}
      onBack={companyBrief.closeBrief}
      isEmbedded={isEmbedded}
    />
  ) : (
    <VoiceCueSidebar
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      onActivate={onCueActivate}
      isEmbedded={isEmbedded}
      hasCompany={hasCompany}
      speakerAttribution={speakerAttribution}
      // AC-V2.8: the rail's disclosure is a permission statement, and the
      // attribution flag alone under-claims (see cuePolicy.js's
      // `effectiveAttribution`). The same snapshot TranscriptView and the
      // correction bar already render is the evidence that keeps this rail
      // from calling cues button-only in a session that can separate voices.
      speakerSnapshot={speakerSnapshot}
    />
  );
}
