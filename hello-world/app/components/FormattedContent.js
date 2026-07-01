"use client";

import Box from "@mui/material/Box";

const JOB_DESCRIPTION_HEADINGS = [
  "About the Role",
  "About You",
  "About Us",
  "What You'll Do",
  "What You Will Do",
  "What We're Looking For",
  "What We Are Looking For",
  "Responsibilities",
  "Key Responsibilities",
  "Requirements",
  "Minimum Qualifications",
  "Preferred Qualifications",
  "Qualifications",
  "Nice to Have",
  "Must Have",
  "Skills",
  "Experience",
  "Benefits",
  "Compensation",
  "Interview Process",
  "Equal Opportunity",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeJobDescriptionText(text) {
  if (!text) return "";

  let normalized = text.replace(/\r\n/g, "\n").replace(/ /g, " ");

  normalized = normalized.replace(/\s*[•·▪◦]\s*/g, "\n• ");

  for (const heading of JOB_DESCRIPTION_HEADINGS) {
    const pattern = new RegExp(`(^|\\s+)(${escapeRegExp(heading)})(:)?(?=\\s|$)`, "gi");
    normalized = normalized.replace(pattern, (_match, prefix, title, colon) => {
      const suffix = colon ? ":" : "";
      return `${prefix.includes("\n") ? "" : "\n\n"}${title}${suffix}\n`;
    });
  }

  normalized = normalized
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

// Renders plain-text content (job descriptions, resumes) with basic structure.
export default function FormattedContent({ text, kind }) {
  if (!text) return null;
  const normalizedText = kind === "jd" ? normalizeJobDescriptionText(text) : text;
  const blocks = normalizedText.split(/\n{2,}/);
  return (
    <Box sx={{ fontSize: kind === "jd" ? 14 : 13.5, lineHeight: kind === "jd" ? 1.8 : 1.75, color: "inherit" }}>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trimEnd()).filter((l, idx, arr) => idx > 0 || l !== "");
        if (lines.length === 0) return null;

        // Single-line block that looks like a section heading
        if (lines.length === 1) {
          const line = lines[0].trim();
          const isHeading =
            line.length > 0 &&
            line.length < 80 &&
            (line === line.toUpperCase() || /^[A-Z][^a-z]{2,}$/.test(line) || line.endsWith(":"));
          if (isHeading) {
            return (
              <Box
                key={i}
                sx={{
                  fontWeight: 700,
                  fontSize: kind === "resume" ? 14 : 14.5,
                  mt: i > 0 ? 2.5 : 0,
                  mb: kind === "jd" ? 1 : 0.5,
                  borderBottom: kind === "resume" ? "1px solid rgba(0,0,0,0.12)" : kind === "jd" ? "1px solid var(--accent-soft)" : "none",
                  pb: kind === "resume" ? 0.25 : kind === "jd" ? 0.35 : 0,
                  letterSpacing: kind === "jd" ? 0.15 : 0.3,
                  color: kind === "jd" ? "var(--accent)" : "inherit",
                }}
              >
                {line.endsWith(":") ? line.slice(0, -1) : line}
              </Box>
            );
          }
        }

        // Block where majority of lines are bullet points
        const bulletLines = lines.filter((l) => /^\s*[-•*–·]\s/.test(l));
        if (bulletLines.length > 0 && bulletLines.length >= Math.ceil(lines.length * 0.5)) {
          return (
            <Box
              key={i}
              component="ul"
              sx={{ m: 0, mt: i > 0 ? 1 : 0, pl: 2.75, "& li": { mb: kind === "jd" ? 0.8 : 0.4 } }}
            >
              {lines.map((line, j) => {
                const clean = line.replace(/^\s*[-•*–·]\s*/, "").trim();
                if (!clean) return null;
                return <li key={j}>{clean}</li>;
              })}
            </Box>
          );
        }

        // Regular paragraph / block
        return (
          <Box
            key={i}
            sx={{
              mt: i > 0 ? 1.5 : 0,
              whiteSpace: "pre-wrap",
              color: kind === "jd" ? "rgba(0, 0, 0, 0.82)" : "inherit",
            }}
          >
            {block.trim()}
          </Box>
        );
      })}
    </Box>
  );
}
