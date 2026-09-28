"use client";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// N61 -- the cover letter's inserted-fact review strip: the owner's "I
// should be able to remove any of the facts with a simple click." One row
// per fact currently in the letter, each with its OWN one-click Remove
// control -- no confirm, no mode switch (AC-N61.14/.15). Removal only ever
// REDUCES what reaches an employer, so a confirmation dialog would guard the
// wrong direction, not the right one.
//
// A fact's source link is rendered only when `safeExternalHref` accepts its
// url -- a refused or grounding-redirect url renders no link at all, the
// same rule CompanyResearchDialog's own ArticleLinkButton applies (AC-N61.10).
//
// No Tooltip wrapper on the Remove control: MUI's Tooltip can steal a
// child's own accessible name, and this control's aria-label IS the
// reachability contract removal's render-and-click tests key on.
export default function InsertedFactsStrip({ facts = [], onRemove }) {
  const list = Array.isArray(facts) ? facts : [];
  if (list.length === 0) return null;
  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
      <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.5 }}>
        Added from research
      </Box>
      {list.map((fact) => {
        const href = safeExternalHref(fact?.url);
        return (
          <Box key={fact.id} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mb: 0.5 }}>
            <Box sx={{ flex: 1, fontSize: "0.8rem" }}>
              {fact.title || fact.text}
              {href ? (
                <IconButton size="small" component="a" href={href} target="_blank" rel="noopener noreferrer" aria-label="Open the source article" sx={{ p: 0.25, ml: 0.5 }}>
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
              ) : null}
            </Box>
            <IconButton size="small" aria-label="Remove this fact" onClick={() => onRemove?.(fact.id)} sx={{ p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        );
      })}
    </Box>
  );
}
