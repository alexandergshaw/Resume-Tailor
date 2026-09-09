"use client";

import { useState } from "react";
import { isDocxResume, isTextResume, extractResumeTextLines } from "../../lib/document/docx";
import { parseEmploymentHistory } from "../../lib/resume/parseEmployment";

// "Import from résumé" on the Materials tab's Employment History section: read
// a .docx/.txt on-device, get positions out of it (Gemini route, or the
// heuristic parser on the Embedded engine / when the route is down), and
// append them to the user's employment list.
//
// It owns one piece of state -- the action's own loading/error/message
// banner -- and one async handler; the employment list itself stays with
// useProfileEntries(EMPLOYMENT_CONFIG) in page.js and is passed in as
// `employmentCtl`, because the Materials tab's other two sections share that
// same controller shape.
//
// WHY THIS IS ORDER-PRESERVING. This hook contains no effect at all, so it
// cannot reorder one; page.js calls it where the handler already sat, and the
// single useState moves down to meet it. See
// app/hooks/useEmploymentImport.extraction.test.js.
export function useEmploymentImport({ employmentCtl, tailorEngine }) {
  // Status of the "import from résumé" action on the Employment History section.
  const [employmentImport, setEmploymentImport] = useState({ loading: false, error: "", message: "" });

  // Extract employment history from an uploaded résumé (.docx/.txt) and append
  // the detected positions to the list (capped at 4). The file is parsed to text
  // on-device. On the Embedded engine we parse it entirely on-device with the
  // heuristic parser (no network/LLM); otherwise we send it to
  // /api/extract-employment (Gemini) and fall back to that same parser if the
  // route is unavailable. Existing non-empty entries are preserved; fields stay
  // editable so the user can fix any misses.
  async function importEmploymentFromResume(file) {
    if (!file) return;
    if (!isDocxResume(file) && !isTextResume(file)) {
      setEmploymentImport({ loading: false, error: "Upload a .docx or .txt résumé.", message: "" });
      return;
    }
    setEmploymentImport({ loading: true, error: "", message: "" });
    try {
      const lines = await extractResumeTextLines(file);
      const resumeText = lines.join("\n");

      let positions = [];
      let usedAi = false;
      // Embedded engine: parse on-device only, never call the LLM route.
      if (tailorEngine !== "embedded") {
        try {
          const res = await fetch("/api/extract-employment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resumeText, engine: tailorEngine }),
          });
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json?.positions)) {
              positions = json.positions;
              usedAi = true;
            }
          }
        } catch {
          // Network/route error — fall through to the offline parser.
        }
      }
      if (!usedAi) {
        positions = parseEmploymentHistory(lines);
      }

      if (positions.length === 0) {
        setEmploymentImport({
          loading: false,
          error: "",
          message: "Couldn't detect any employment history. Add entries manually below.",
        });
        return;
      }
      const existing = employmentCtl.entries.filter(
        (e) => e.company || e.title || e.location || e.startDate || e.endDate || e.notes,
      );
      // Skip positions that already exist (by company + title) so re-uploading
      // the same résumé doesn't stack duplicate entries.
      const dedupeKey = (e) =>
        `${(e.company || "").trim().toLowerCase()}|${(e.title || "").trim().toLowerCase()}`;
      const existingKeys = new Set(existing.map(dedupeKey));
      const room = Math.max(0, 4 - existing.length);
      const additions = positions
        .filter((p) => !existingKeys.has(dedupeKey(p)))
        .slice(0, room)
        .map((entry) => ({
          id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          company: entry.company || "",
          title: entry.title || "",
          location: entry.location || "",
          startDate: entry.startDate || "",
          endDate: entry.endDate || "",
          notes: entry.notes || "",
        }));
      const added = additions.length;
      employmentCtl.setEntries([...existing, ...additions]);
      employmentCtl.setOpen(true);
      const suffix = usedAi ? "" : " (offline parser — AI unavailable)";
      const noRoomMessage =
        existing.length >= 4
          ? "Your 4 employment slots are already full."
          : "Those positions are already in your list.";
      setEmploymentImport({
        loading: false,
        error: "",
        message:
          added > 0
            ? `Imported ${added} position${added === 1 ? "" : "s"}${suffix}. Review and edit as needed.`
            : noRoomMessage,
      });
    } catch (err) {
      setEmploymentImport({
        loading: false,
        error: `Couldn't read that résumé: ${err?.message || "unknown error"}`,
        message: "",
      });
    }
  }

  return { employmentImport, importEmploymentFromResume };
}
