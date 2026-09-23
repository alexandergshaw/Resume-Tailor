"use client";

// N49: one interview stage on a SNAPSHOT-carrying pack -- the stage name, its
// confidence token, its roles, its dropped-titles disclosure and its
// questions, each item wearing its own N49 apparatus. Used only from the
// snapshot branch of PrepPackPanel.js's StagesSection: `stageSupportPlacement`
// never returns "name" for a snapshot stage (design.r3.md section 8.2), so
// this component never has to draw N43's marker on the name line the way the
// legacy (snapshot-less) code path still does -- that path is untouched, in
// its own function, and this one exists so it stays that way.
//
// DOM contract (PrepPackPanel.n49Frame.test.js's own header): `[data-n49-item]`
// hosts exactly one `[data-n49-token]` plus zero or more `a[data-n49-source]`
// siblings; `[data-n49-roles-dropped]` is the refused-titles disclosure.
import Box from "@mui/material/Box";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost } from "@/lib/tracking/citationHref";
import { stageItemLabel, stageItemSources, researchStateOf } from "@/lib/interviewPrep/stageResearchView";

/** The confidence token plus its research-source links for one item. Never
 *  builds an anchor from a URL the href gate refuses -- a stored count can
 *  be stale or forged, and the item stays visible either way, just without
 *  a link for that source. */
function Apparatus({ provenance, snapshot, numbers }) {
  const label = stageItemLabel(provenance, snapshot);
  const entries = stageItemSources(provenance, snapshot);
  return (
    <>
      {" "}
      <Box component="span" data-n49-token={label.kind} sx={{ fontSize: 11, color: "var(--text-secondary)" }}>
        {label.text}
      </Box>
      {entries.map((entry) => {
        const href = safeExternalHref(entry.url);
        if (href === null) {
          return (
            <Box component="span" key={entry.index} data-n49-source-inert="" sx={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {" "}
              (source link unavailable)
            </Box>
          );
        }
        const host = citationHost(href);
        const n = numbers.get(entry.url);
        return (
          <Box
            component="a"
            key={entry.index}
            data-n49-source={String(n)}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source ${n}: ${host}`}
            sx={{ fontSize: 11, color: "inherit" }}
          >
            {" "}
            {host}
          </Box>
        );
      })}
    </>
  );
}

/** The stages group's research-state line -- rendered as a SIBLING of
 *  StagesSection/EmptySection (never from inside either), so it is reachable
 *  even when the stage list is empty or the section is incomplete
 *  (plan.r4.md section 5.2, M1). Returns null for a snapshot-less pack. */
export function StagesResearchState({ pack }) {
  const state = researchStateOf(pack);
  if (!state) return null;
  return (
    <Box data-n49-state={state.state} sx={{ mt: 1, mb: 0, fontSize: 12, color: "var(--text-secondary)" }}>
      {state.text}
    </Box>
  );
}

export default function PrepStageBlock({ stage, snapshot, numbers, answerMarker }) {
  const roles = Array.isArray(stage?.roles) ? stage.roles : [];
  const roleProvenance = Array.isArray(stage?.roleProvenance) ? stage.roleProvenance : [];
  const questionProvenance = Array.isArray(stage?.questionProvenance) ? stage.questionProvenance : [];
  const dropped = Number.isInteger(stage?.rolesDroppedCount) ? stage.rolesDroppedCount : 0;
  return (
    <Box sx={{ mb: 1 }}>
      <Box data-n49-item="stage" sx={{ mt: 0, mb: 0 }}>
        <Box component="h4" sx={{ display: "inline", fontWeight: 700, fontSize: 13.5, mt: 0, mb: 0 }}>
          {stage?.name}
        </Box>
        <Apparatus provenance={stage?.provenance} snapshot={snapshot} numbers={numbers} />
      </Box>
      {roles.length > 0 ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {roles.map((role, i) => (
            <Box component="li" key={i} data-n49-item="role" sx={{ fontSize: 12.5 }}>
              {role}
              <Apparatus provenance={roleProvenance[i]} snapshot={snapshot} numbers={numbers} />
            </Box>
          ))}
        </Box>
      ) : null}
      {dropped > 0 ? (
        <Box data-n49-roles-dropped={String(dropped)} sx={{ mt: 0.25, mb: 0, fontSize: 12, color: "var(--text-secondary)" }}>
          {`${dropped} reported interviewer titles could not be shown here.`}
        </Box>
      ) : null}
      {Array.isArray(stage?.questions) ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {stage.questions.map((question, qi) => (
            <Box component="li" key={qi} data-n49-item="question" sx={{ fontSize: 13 }}>
              {question}
              <Apparatus provenance={questionProvenance[qi]} snapshot={snapshot} numbers={numbers} />
            </Box>
          ))}
        </Box>
      ) : null}
      {answerMarker}
    </Box>
  );
}
