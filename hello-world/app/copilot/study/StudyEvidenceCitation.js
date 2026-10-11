"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { citationHost, servesGroundingRedirect } from "@/lib/tracking/citationHref";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// N157 SC-C (C-b): the bounded source list under one study card.
//
// A stored plan row is UNTRUSTED at the render boundary. The generator filtered
// its citations once (studyPlanEvidence.js), and this component defends again:
// every url is re-run through the shared href gate at render, a refused url is
// shown as inert text and never as an anchor, a Gemini grounding-redirect host
// is never linked, and two urls on one host collapse to the first. The visible
// label of each link is the host derived from that SAME url (citationHost), so
// a link never names a publisher its href does not go to.
//
// BOUND. An embedded plan stamps the digest's whole citation list on every
// card, so an unbounded list is a scroll marathon. At most MAX_INLINE_SOURCES
// hosts render; the rest are behind a "Show all sources (n)" disclosure and are
// NOT in the DOM until it is opened (conditional render, not CSS-hidden), so the
// bound is the same to a screen reader and to a DOM count.

// How many distinct source hosts show before the disclosure. A seat-flagged
// GUESS (design r2 section 13), exported so the owner retunes it on a phone and
// the test reads the constant rather than a copy of it.
export const MAX_INLINE_SOURCES = 3;

// One entry per distinct usable host, plus whether any citation was refused.
// Redirect hosts are dropped without a trace: they are not the publisher's and
// the generator never keeps them, so one reaching here is a defect upstream.
function resolveSources(citations) {
  const sources = [];
  const hosts = new Set();
  let unavailable = false;
  for (const citation of Array.isArray(citations) ? citations : []) {
    const url = citation?.url;
    const host = citationHost(url);
    if (host === null) {
      unavailable = true;
      continue;
    }
    if (servesGroundingRedirect(host, url) || hosts.has(host)) continue;
    hosts.add(host);
    sources.push({ host, url });
  }
  return { sources, unavailable };
}

function SourceItem({ source }) {
  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Link
        href={safeExternalHref(source.url)}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ display: "inline-flex", alignItems: "center", ...TOUCH_TARGET_SX, ...BREAK_LONG_WORDS_SX }}
      >
        {source.host}
      </Link>
    </Box>
  );
}

export default function StudyEvidenceCitation({ citations }) {
  const [expanded, setExpanded] = useState(false);
  const { sources, unavailable } = resolveSources(citations);
  if (sources.length === 0 && !unavailable) return null;

  const inline = sources.slice(0, MAX_INLINE_SOURCES);
  const rest = sources.slice(MAX_INLINE_SOURCES);

  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0, minWidth: 0 }}>
        {inline.map((source) => (
          <SourceItem key={source.host} source={source} />
        ))}
        {expanded ? rest.map((source) => <SourceItem key={source.host} source={source} />) : null}
        {unavailable ? (
          <Box component="li" sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              {STUDY_COPY.sources.linkUnavailable}
            </Typography>
          </Box>
        ) : null}
      </Stack>
      {rest.length > 0 ? (
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          sx={{ ...TOUCH_TARGET_SX, alignSelf: "flex-start" }}
        >
          {STUDY_COPY.sources.showAll.replace("<n>", () => String(sources.length))}
        </Button>
      ) : null}
    </Stack>
  );
}
