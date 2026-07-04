"use client";

import { useEffect, useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import profileData from "@/lib/llm/engines/tailor-lite/data/profile.json";
import { focusOverrideHint, buzzwordEditCounts } from "@/lib/tailor/localSignals";
import { TAXONOMY_CATEGORIES } from "@/lib/llm/engines/tailor-lite/library/validate";
import { isNoiseTopic } from "@/lib/llm/engines/tailor-lite/topicNoise";

const AUTO = "__auto__";

// Title-case a RAKE phrase for display/storage ("culture change" -> "Culture
// Change"), keeping minor connectors lowercase unless they lead.
const MINOR_WORDS = new Set(["and", "or", "of", "the", "a", "an", "to", "for", "with", "in", "on", "at", "by"]);
function titleCasePhrase(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Bundled default focus areas (13KB JSON — safe to ship to the client). Users
// whose library was seeded before a default was added won't have it in their
// rows; the picker offers those and adds the chosen one to the library on apply.
const DEFAULT_AREAS = Array.isArray(profileData.focus_areas) ? profileData.focus_areas : [];

// Categories whose extracted keywords are worth toggling (matches the skill
// categories the slot mapper actually consumes).
const SKILL_CATS = ["technology", "tool_platform", "domain", "methodology", "soft_skill", "certification", "subject"];
const MAX_LISTED = 24;
// Extra multiword "topic" phrases (RAKE) shown beyond the taxonomy hits. For
// soft-skill / non-technical roles the taxonomy barely fires, so these phrases
// ("culture change", "stakeholder engagement") ARE the vocabulary to save.
const MAX_TOPICS = 12;

// When a brand-new focus area is created from the previewer, seed its capability
// lists straight from the posting's own extracted buzzwords — grouped the way the
// strategy maps taxonomy categories onto area fields (see strategy.js SLOTS):
// tech/tools become technical capabilities, domains become domain capabilities,
// methodologies become job emphases, and subjects seed the teaching-subject row.
const CATEGORY_TO_AREA_FIELD = {
  technology: "technical_capabilities",
  tool_platform: "technical_capabilities",
  domain: "domain_capabilities",
  methodology: "job_emphases",
  subject: "subjects",
};
// Uncategorized RAKE phrases (soft-skill / non-technical vocabulary) seed the
// area's domain capabilities — where a non-technical focus surfaces them.
const TOPIC_AREA_FIELD = "domain_capabilities";

// The previewer's "wrong focus" modal: pick which library focus area should
// drive this posting's documents, AND pick-and-choose the buzzwords applied —
// uncheck a term to remove it from both documents (alias-aware, including the
// focus area's own emphasis lists), or add one to emphasize it. Optionally
// teaches the library (adds the posting's title to the chosen area's match
// terms) — only when the checkbox is explicitly ticked.
//
// Render with a `key` that changes per open so each opening remounts fresh —
// state initializes from props, no reset effects needed.
const VARIANT_OPTIONS = [
  { value: "", label: "Auto-detect" },
  { value: "industry", label: "Technical (industry)" },
  { value: "nontechnical", label: "Non-technical (leadership)" },
  { value: "teaching", label: "Teaching (adjunct framing)" },
  { value: "staff", label: "University staff" },
];

export default function FocusPickerDialog({
  open,
  embedded = false,
  currentFocus,
  override,
  keywords,
  keywordEdits,
  coverVariant,
  coverVariantOverride,
  persona,
  personaOverride,
  postingTitle,
  onClose,
  onApply,
}) {
  const [areas, setAreas] = useState(null); // null = loading, [] = none/failed
  const [personas, setPersonas] = useState(null); // null = loading, [] = none/failed
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState(() => override || currentFocus?.name || AUTO);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Persona selector state: "" = base profile
  const [personaChoice, setPersonaChoice] = useState(() => personaOverride || "");

  // Buzzword toggles: everything the engine extracted for this posting, plus
  // any previously-excluded terms (kept visible so they can be re-enabled).
  const listed = useMemo(() => {
    const items = [];
    const seen = new Set();
    for (const cat of SKILL_CATS) {
      for (const it of keywords?.[cat] || []) {
        const key = String(it.canonical).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ canonical: it.canonical, category: cat, score: it.score || 0 });
      }
    }
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, MAX_LISTED);
    // Multiword phrases the taxonomy missed (RAKE "topic") — the bulk of the
    // useful vocabulary for soft-skill / non-technical roles. Noise-filtered and
    // title-cased so they're selectable and savable alongside the taxonomy hits.
    let topicCount = 0;
    for (const it of keywords?.topic || []) {
      if (topicCount >= MAX_TOPICS) break;
      if (isNoiseTopic(it.canonical)) continue;
      const display = titleCasePhrase(it.canonical);
      const key = display.toLowerCase();
      if (!display || seen.has(key)) continue;
      seen.add(key);
      top.push({ canonical: display, category: "phrase", score: it.score || 0 });
      topicCount += 1;
    }
    for (const name of keywordEdits?.exclude || []) {
      const key = String(name).toLowerCase();
      if (!top.some((i) => i.canonical.toLowerCase() === key)) {
        top.push({ canonical: name, category: "", score: 0 });
      }
    }
    return top;
  }, [keywords, keywordEdits]);

  const [excluded, setExcluded] = useState(
    () => new Set((keywordEdits?.exclude || []).map((n) => String(n).toLowerCase())),
  );
  const [boosts, setBoosts] = useState(() => [...(keywordEdits?.boost || [])]);
  const [addText, setAddText] = useState("");
  // "" = emphasize on this posting only; a category = also add the term to the
  // library's taxonomy so the engine recognizes it from now on.
  const [addCategory, setAddCategory] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addNote, setAddNote] = useState(null); // { ok, message } | null
  // New focus area (name-only scaffold; flesh it out in /library).
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaBusy, setNewAreaBusy] = useState(false);
  const [newAreaNote, setNewAreaNote] = useState(null); // { ok, message } | null
  // Cover-letter framing (teaching/staff/industry, "" = auto-detect).
  const [variantChoice, setVariantChoice] = useState(() => coverVariantOverride || "");

  // New persona (created inline, no /library trip): name + an optional headline
  // role, seeded from this posting. Only `name` is required by the API; a bare
  // persona just passes the base profile through until refined in /library.
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaHeadline, setNewPersonaHeadline] = useState(() => String(postingTitle || "").trim());
  const [newPersonaBusy, setNewPersonaBusy] = useState(false);
  const [newPersonaNote, setNewPersonaNote] = useState(null); // { ok, message } | null
  const [addingPersona, setAddingPersona] = useState(false);

  // Cross-posting learning signals (device-local), read fresh per open (the
  // dialog remounts via its key): recurring exclusion counts badge the
  // checklist, and a recurring focus correction for THIS detected area
  // surfaces as an edit-your-library insight.
  const [editCounts] = useState(() => buzzwordEditCounts());
  const [detectionInsight] = useState(() =>
    currentFocus?.source === "override" ? "" : focusOverrideHint(currentFocus?.name || ""),
  );

  // Load the library's focus areas and personas when the dialog opens (they're small, and
  // the user may have edited /library since the last open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // silent = a background refresh (e.g. window regained focus after editing
    // /library in another tab): don't blank the lists back to their loading
    // spinner, just fold in any newly-saved rows.
    const load = async ({ silent } = {}) => {
      try {
        const res = await fetch("/api/library");
        if (res.status === 401) {
          if (!cancelled) {
            setAreas([]);
            setPersonas([]);
            setLoadError("Sign in to use your library's focus areas and personas.");
          }
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Couldn't load your library.");
        if (!cancelled) {
          setAreas(Array.isArray(data?.focusAreas) ? data.focusAreas : []);
          setPersonas(Array.isArray(data?.personas) ? data.personas : []);
          setLoadError("");
        }
      } catch (err) {
        if (!cancelled && !silent) {
          setAreas([]);
          setPersonas([]);
          setLoadError(err?.message || "Couldn't load your library.");
        }
      }
    };
    load();
    // Re-pull when the tab regains focus so a persona/area added over in the
    // /library tab shows up here without closing and reopening the picker.
    const onFocus = () => load({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [open]);

  // The pickable list: the user's library areas plus bundled defaults their
  // seeded library predates (marked, and added to the library on apply).
  const pickable = useMemo(() => {
    if (areas === null) return null;
    const have = new Set(areas.map((a) => String(a.name || "").toLowerCase()));
    return [
      ...areas.map((a) => ({ ...a, isDefault: false })),
      ...DEFAULT_AREAS.filter((d) => !have.has(String(d.name || "").toLowerCase())).map((d) => ({
        ...d,
        isDefault: true,
      })),
    ];
  }, [areas]);

  const chosenArea = choice !== AUTO ? (pickable || []).find((a) => a.name === choice) : null;
  const selectedPersona = personaChoice
    ? (personas || []).find((p) => String(p.name || "") === personaChoice)
    : null;
  const title = String(postingTitle || "").trim();
  const canRemember = !!chosenArea && !!title && !(chosenArea.match || []).some(
    (t) => String(t).toLowerCase() === title.toLowerCase(),
  );

  function toggleTerm(name) {
    const key = String(name).toLowerCase();
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Add a buzzword: always emphasized on this posting; with a category chosen,
  // it's ALSO added to the library's taxonomy first so the engine recognizes it
  // from now on (a per-posting boost of an unknown term can't apply otherwise).
  async function addBoost() {
    const name = addText.trim();
    if (!name || addBusy) return;
    setAddNote(null);
    if (addCategory) {
      setAddBusy(true);
      try {
        const res = await fetch("/api/library/taxonomy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canonical: name, category: addCategory, aliases: [] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            res.status === 401
              ? "Sign in to add buzzwords to your library."
              : data?.error || (Array.isArray(data?.errors) ? data.errors.join(" ") : "Couldn't add the buzzword."),
          );
        }
        setAddNote({ ok: true, message: `“${name}” added to your library (${addCategory.replace(/_/g, " ")}).` });
      } catch (err) {
        setAddNote({ ok: false, message: err?.message || "Couldn't add the buzzword." });
        setAddBusy(false);
        return;
      }
      setAddBusy(false);
    }
    setBoosts((prev) =>
      prev.some((b) => b.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name],
    );
    setAddText("");
  }

  // Group this posting's extracted buzzwords into the shape a focus area stores,
  // so a newly-created area starts pre-populated from the posting instead of
  // empty. Skips terms the user unchecked above, dedupes across fields, and keeps
  // the highest-scoring terms first within each field.
  function postingWordsForArea() {
    const fields = { subjects: [], job_emphases: [], technical_capabilities: [], domain_capabilities: [] };
    const pairs = [];
    for (const [cat, field] of Object.entries(CATEGORY_TO_AREA_FIELD)) {
      for (const it of keywords?.[cat] || []) {
        pairs.push({ field, canonical: String(it.canonical || "").trim(), score: it.score || 0 });
      }
    }
    // Include the RAKE "topic" phrases (the soft-skill vocabulary the taxonomy
    // misses) so a non-technical focus is seeded with real content, not left bare.
    for (const it of keywords?.topic || []) {
      if (isNoiseTopic(it.canonical)) continue;
      const display = titleCasePhrase(it.canonical);
      if (display) pairs.push({ field: TOPIC_AREA_FIELD, canonical: display, score: it.score || 0 });
    }
    pairs.sort((a, b) => b.score - a.score);
    const seen = new Set();
    for (const { field, canonical } of pairs) {
      const key = canonical.toLowerCase();
      if (!canonical || seen.has(key) || excluded.has(key)) continue;
      seen.add(key);
      fields[field].push(canonical);
    }
    const count = Object.values(fields).reduce((n, arr) => n + arr.length, 0);
    return { fields, count };
  }

  // Create a focus area in the library, seeded with this posting's applicable
  // buzzwords, then select it. Point at /library for further refinement.
  async function addFocusArea() {
    const name = newAreaName.trim();
    if (!name || newAreaBusy) return;
    if ((pickable || []).some((a) => String(a.name).toLowerCase() === name.toLowerCase())) {
      setNewAreaNote({ ok: false, message: `“${name}” already exists — select it above.` });
      return;
    }
    setNewAreaBusy(true);
    setNewAreaNote(null);
    const { fields, count } = postingWordsForArea();
    try {
      const res = await fetch("/api/library/focus-areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, match: [name], ...fields }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Sign in to add focus areas to your library."
            : data?.error || (Array.isArray(data?.errors) ? data.errors.join(" ") : "Couldn't add the focus area."),
        );
      }
      setAreas((prev) => [...(prev || []), data.row || { name, match: [name], ...fields }]);
      setChoice(name);
      setNewAreaName("");
      setNewAreaNote({
        ok: true,
        message:
          count > 0
            ? `“${name}” added and selected — seeded with ${count} word${count === 1 ? "" : "s"} pulled from this posting. Refine it in /library.`
            : `“${name}” added and selected. No posting buzzwords to pull yet — flesh it out in /library.`,
      });
    } catch (err) {
      setNewAreaNote({ ok: false, message: err?.message || "Couldn't add the focus area." });
    } finally {
      setNewAreaBusy(false);
    }
  }

  // Create a persona in the library inline, then select it — no /library round
  // trip. Seeds the headline role (PRIMARY_FUNCTION) from the entered headline
  // (defaulted to the posting title) and the specialization from the posting's
  // top domain/subject buzzword, so the persona starts plausible, not empty.
  // Everything else can be refined later in /library.
  async function addPersona() {
    const name = newPersonaName.trim();
    if (!name || newPersonaBusy) return;
    if ((personas || []).some((p) => String(p.name).toLowerCase() === name.toLowerCase())) {
      setNewPersonaNote({ ok: false, message: `“${name}” already exists — select it above.` });
      return;
    }
    setNewPersonaBusy(true);
    setNewPersonaNote(null);
    // Seed values from the posting (only non-empty ones are kept by the API).
    const headline = newPersonaHeadline.trim();
    const topDomain =
      (keywords?.domain || [])[0]?.canonical || (keywords?.subject || [])[0]?.canonical || "";
    const values = {};
    if (headline) values.PRIMARY_FUNCTION = headline;
    if (topDomain) values.SPECIALIZATION = topDomain;
    try {
      const res = await fetch("/api/library/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Sign in to add personas to your library."
            : data?.error || (Array.isArray(data?.errors) ? data.errors.join(" ") : "Couldn't add the persona."),
        );
      }
      const row = data.row || { name, values };
      setPersonas((prev) => [...(prev || []), row]);
      setPersonaChoice(name);
      setNewPersonaName("");
      setNewPersonaHeadline(String(postingTitle || "").trim());
      const seeded = Object.keys(values).length;
      setNewPersonaNote({
        ok: true,
        message:
          seeded > 0
            ? `“${name}” added and selected — seeded from this posting. Refine the full identity in /library.`
            : `“${name}” added and selected. Flesh out its identity in /library.`,
      });
    } catch (err) {
      setNewPersonaNote({ ok: false, message: err?.message || "Couldn't add the persona." });
    } finally {
      setNewPersonaBusy(false);
    }
  }

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (chosenArea?.isDefault) {
        // A bundled default the user's library predates: add it to the library
        // now (with the posting title folded into its match terms when the
        // remember box is ticked), so the engine can resolve it by name.
        const { isDefault, ...fields } = chosenArea;
        void isDefault;
        const res = await fetch("/api/library/focus-areas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            match: remember && canRemember ? [...(fields.match || []), title] : fields.match || [],
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            res.status === 401
              ? "Sign in to add this focus area to your library."
              : data?.error || "Couldn't add the focus area to your library.",
          );
        }
      } else if (remember && canRemember) {
        // Teach the library (explicit opt-in only): add the posting title to
        // the area's match terms so similar postings auto-select this focus.
        const res = await fetch("/api/library/focus-areas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...chosenArea, match: [...(chosenArea.match || []), title] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "Couldn't update the focus area's match terms.");
        }
      }
      const exclude = listed
        .filter((i) => excluded.has(i.canonical.toLowerCase()))
        .map((i) => i.canonical);
      const edits = boosts.length > 0 || exclude.length > 0 ? { boost: boosts, exclude } : null;
      const ok = await onApply(choice === AUTO ? "" : choice, edits, variantChoice, personaChoice);
      if (ok === false) throw new Error("Couldn't regenerate with those settings.");
      onClose();
    } catch (err) {
      setError(err?.message || "Couldn't apply the changes.");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}>
          <Box sx={{ flex: 1, fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {currentFocus?.name
              ? `These documents were tailored with the “${currentFocus.name}” focus (${currentFocus.source === "override" ? "pinned by you" : "auto-detected"}).`
              : "No focus area was detected for this posting, so the documents got generic emphasis."}{" "}
            Pick the focus they should have — both documents regenerate with it.
          </Box>
          <Button
            component="a"
            href="/library"
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            sx={{ textTransform: "none", whiteSpace: "nowrap", flexShrink: 0, fontSize: "0.78rem" }}
            title="Open the library editor in a new tab to change which focus areas and buzzwords exist."
          >
            Edit in /library ↗
          </Button>
        </Box>
        {detectionInsight ? (
          <Box
            sx={{
              mb: 1,
              px: 1,
              py: 0.75,
              fontSize: "0.8rem",
              lineHeight: 1.4,
              color: "var(--text-primary)",
              backgroundColor: "var(--accent-soft)",
              borderRadius: 1,
            }}
          >
            {detectionInsight}
          </Box>
        ) : null}
        {areas === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={22} />
          </Box>
        ) : (
          <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value)}>
            <FormControlLabel
              value={AUTO}
              control={<Radio size="small" />}
              label={<Box sx={{ fontSize: "0.9rem" }}>Auto-detect from the posting</Box>}
            />
            {(pickable || []).map((a) => (
              <FormControlLabel
                key={a.id || a.name}
                value={a.name}
                control={<Radio size="small" />}
                label={
                  <Box sx={{ fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 0.75 }}>
                    {a.name}
                    {a.isDefault ? (
                      <Box
                        component="span"
                        title="A bundled default your library doesn't have yet — applying adds it to your library."
                        sx={{
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          color: "var(--accent)",
                          backgroundColor: "var(--accent-soft)",
                          borderRadius: 1,
                          px: 0.5,
                          py: 0.1,
                        }}
                      >
                        default — adds to library
                      </Box>
                    ) : null}
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        )}
        {loadError ? (
          <Box sx={{ mt: 1, fontSize: "0.8rem", color: "var(--danger)" }}>{loadError}</Box>
        ) : null}
        {pickable !== null && pickable.length === 0 && !loadError ? (
          <Box sx={{ mt: 1, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Your library has no focus areas yet — add them in{" "}
            <a href="/library" target="_blank" rel="noopener noreferrer">/library</a>.
          </Box>
        ) : null}
        {canRemember ? (
          <FormControlLabel
            sx={{ mt: 1, alignItems: "flex-start" }}
            control={
              <Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} sx={{ pt: 0 }} />
            }
            label={
              <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Auto-select this focus for similar postings (adds “{title}” to the “{chosenArea.name}”
                match terms in your library)
              </Box>
            }
          />
        ) : null}

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="New focus area (e.g. Data Engineering) — seeded from this posting"
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFocusArea();
              }
            }}
            disabled={newAreaBusy}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={addFocusArea}
            disabled={!newAreaName.trim() || newAreaBusy || areas === null}
            startIcon={newAreaBusy ? <CircularProgress size={12} /> : null}
            sx={{ textTransform: "none", whiteSpace: "nowrap" }}
          >
            Add area
          </Button>
        </Box>
        {newAreaNote ? (
          <Box sx={{ mt: 0.5, fontSize: "0.78rem", color: newAreaNote.ok ? "var(--text-secondary)" : "var(--danger)" }}>
            {newAreaNote.message}
          </Box>
        ) : (
          <Box sx={{ mt: 0.5, fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
            The new area is pre-filled with this posting&apos;s buzzwords (the checked ones above) as
            its technical, domain, and subject capabilities — tune it later in /library.
          </Box>
        )}

        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
          <Box sx={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Positioning (persona)
          </Box>
          <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4, mt: 0.25, mb: 1 }}>
            Reframe the whole résumé + letter as a saved identity (manage in{" "}
            <a href="/library" target="_blank" rel="noopener noreferrer">/library</a>).
          </Box>
          {personas === null ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
              <CircularProgress size={20} />
            </Box>
          ) : (
            <>
              <Select
                size="small"
                fullWidth
                value={personaChoice}
                onChange={(e) => setPersonaChoice(e.target.value)}
                displayEmpty
                sx={{ fontSize: "0.85rem", mb: 1 }}
              >
                <MenuItem value="" sx={{ fontSize: "0.85rem" }}>
                  Base profile
                </MenuItem>
                {(personas || []).map((p) => (
                  <MenuItem key={p.id || p.name} value={p.name || ""} sx={{ fontSize: "0.85rem" }}>
                    {p.name || ""}
                  </MenuItem>
                ))}
              </Select>
              {/* Selected persona's inherited defaults (#4): the engine falls back
                  to these unless the focus / framing controls below override them. */}
              {selectedPersona && (selectedPersona.focus_area || selectedPersona.cover_variant) ? (
                <Box sx={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4, mb: 1 }}>
                  <>“{selectedPersona.name}” defaults to</>
                  {selectedPersona.focus_area ? (
                    <> the “{selectedPersona.focus_area}” focus{choice !== AUTO ? " (overridden below)" : ""}</>
                  ) : null}
                  {selectedPersona.focus_area && selectedPersona.cover_variant ? " and" : null}
                  {selectedPersona.cover_variant ? (
                    <> {selectedPersona.cover_variant} framing{variantChoice ? " (overridden below)" : ""}</>
                  ) : null}
                  .
                </Box>
              ) : null}
              <Button
                onClick={() => setAddingPersona((s) => !s)}
                size="small"
                sx={{ textTransform: "none", pl: 0, fontSize: "0.8rem" }}
              >
                {addingPersona ? "Cancel new persona" : "+ New persona"}
              </Button>
              {/* Inline create (#1/#2): add a persona without leaving for /library. */}
              {addingPersona ? (
                <>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="New persona (e.g. Finance Educator) — seeded from this posting"
                      value={newPersonaName}
                      onChange={(e) => setNewPersonaName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPersona();
                        }
                      }}
                      disabled={newPersonaBusy}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={addPersona}
                      disabled={!newPersonaName.trim() || newPersonaBusy}
                      startIcon={newPersonaBusy ? <CircularProgress size={12} /> : null}
                      sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                    >
                      Add persona
                    </Button>
                  </Box>
                  {newPersonaName.trim() ? (
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Headline role (optional, e.g. Finance Instructor)"
                      value={newPersonaHeadline}
                      onChange={(e) => setNewPersonaHeadline(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPersona();
                        }
                      }}
                      disabled={newPersonaBusy}
                      sx={{ mt: 1 }}
                    />
                  ) : null}
                  {newPersonaNote ? (
                    <Box sx={{ mt: 0.5, fontSize: "0.78rem", color: newPersonaNote.ok ? "var(--text-secondary)" : "var(--danger)" }}>
                      {newPersonaNote.message}
                    </Box>
                  ) : (
                    <Box sx={{ mt: 0.5, mb: 0.5, fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                      Creates a saved persona and selects it here — refine its full identity later in /library.
                    </Box>
                  )}
                </>
              ) : null}
            </>
          )}
        </Box>

        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
          <Box sx={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Cover letter framing
          </Box>
          <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4, mt: 0.25 }}>
            {coverVariant?.name
              ? `Currently ${coverVariant.name}${
                  coverVariant.source === "override"
                    ? " (pinned by you)"
                    : coverVariant.detected && coverVariant.detected !== coverVariant.name
                      ? ` (detected as ${coverVariant.detected})`
                      : " (auto-detected)"
                }.`
              : "Pick how the letter frames you — or leave it to detection."}{" "}
            Technical (industry) pitches a product team; non-technical (leadership) leads with
            change and stakeholder work; teaching keeps the adjunct paragraphs; university staff
            swaps them for campus-service prose.
          </Box>
          <RadioGroup
            row
            value={variantChoice}
            onChange={(e) => setVariantChoice(e.target.value)}
            sx={{ mt: 0.5 }}
          >
            {VARIANT_OPTIONS.map((o) => (
              <FormControlLabel
                key={o.value || "auto"}
                value={o.value}
                control={<Radio size="small" />}
                label={<Box sx={{ fontSize: "0.85rem" }}>{o.label}</Box>}
              />
            ))}
          </RadioGroup>
        </Box>

        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
          <Box sx={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
            Buzzwords for this posting
          </Box>
          <Box sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4, mt: 0.25, mb: 0.75 }}>
            Uncheck a term to remove it from both documents (it also comes out of the focus
            area&apos;s emphasis lists). Add a term to make the documents lead with it.
          </Box>
          {listed.length > 0 ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                columnGap: 1,
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {listed.map((item) => (
                <Box key={item.canonical} sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                  <Checkbox
                    size="small"
                    checked={!excluded.has(item.canonical.toLowerCase())}
                    onChange={() => toggleTerm(item.canonical)}
                    sx={{ p: 0.5 }}
                  />
                  <Box sx={{ fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.canonical}
                  </Box>
                  {item.category ? (
                    <Box sx={{ flexShrink: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
                      {item.category.replace(/_/g, " ")}
                    </Box>
                  ) : null}
                  {(editCounts.exclude.get(item.canonical.toLowerCase()) || 0) >= 2 ? (
                    <Box
                      component="span"
                      title="You've excluded this term on multiple postings — consider removing or re-categorizing it in /library."
                      sx={{
                        flexShrink: 0,
                        fontSize: "0.6rem",
                        fontWeight: 700,
                        color: "var(--accent)",
                        backgroundColor: "var(--accent-soft)",
                        borderRadius: 1,
                        px: 0.4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      excluded on {editCounts.exclude.get(item.canonical.toLowerCase())} postings
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : null}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Add a buzzword to emphasize"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBoost();
                  }
                }}
                disabled={addBusy}
              />
              <Select
                size="small"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
                displayEmpty
                disabled={addBusy}
                title="Choose a category to ALSO add this term to your library's taxonomy — required for terms the engine doesn't know yet."
                sx={{ fontSize: "0.8rem", minWidth: 150, flexShrink: 0 }}
              >
                <MenuItem value="" sx={{ fontSize: "0.8rem" }}>
                  emphasize only
                </MenuItem>
                {TAXONOMY_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c} sx={{ fontSize: "0.8rem" }}>
                    + library: {c.replace(/_/g, " ")}
                  </MenuItem>
                ))}
              </Select>
              <Button
                size="small"
                variant="outlined"
                onClick={addBoost}
                disabled={!addText.trim() || addBusy}
                startIcon={addBusy ? <CircularProgress size={12} /> : null}
                sx={{ textTransform: "none" }}
              >
                Add
              </Button>
            </Box>
            {addNote ? (
              <Box sx={{ mt: 0.5, fontSize: "0.78rem", color: addNote.ok ? "var(--text-secondary)" : "var(--danger)" }}>
                {addNote.message}
              </Box>
            ) : null}
            <Box sx={{ mt: 0.5, fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              “Emphasize only” works for terms your library already knows; pick a category to add a
              new term to the library so the engine recognizes it from now on.
            </Box>
            {boosts.length > 0 ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
                {boosts.map((b) => (
                  <Chip
                    key={b}
                    size="small"
                    label={`emphasize: ${b}`}
                    onDelete={() => setBoosts((prev) => prev.filter((x) => x !== b))}
                  />
                ))}
              </Box>
            ) : null}
        </Box>

        {error ? <Box sx={{ mt: 1, fontSize: "0.85rem", color: "var(--danger)" }}>{error}</Box> : null}
    </>
  );

  const actions = (
    <>
      <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
        {embedded ? "Close" : "Cancel"}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button
        onClick={apply}
        disabled={busy || areas === null}
        variant="contained"
        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
        sx={{ textTransform: "none" }}
      >
        Apply &amp; regenerate
      </Button>
    </>
  );

  // Embedded: render the same controls as an inline panel inside the preview/edit
  // modal (no separate Dialog), collapsible via the header's close button.
  if (embedded) {
    if (!open) return null;
    return (
      <Box
        sx={{
          mx: { xs: 1.25, sm: 2 },
          my: 1,
          p: { xs: 1.5, sm: 2 },
          border: "1px solid var(--border)",
          borderRadius: 1,
          bgcolor: "var(--bg-surface)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Box sx={{ fontWeight: 700, fontSize: "0.95rem" }}>Set document focus &amp; buzzwords</Box>
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={onClose} disabled={busy} aria-label="Collapse focus controls">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        {body}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}>
          {actions}
        </Box>
      </Box>
    );
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Set document focus &amp; buzzwords</DialogTitle>
      <DialogContent>{body}</DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>{actions}</DialogActions>
    </Dialog>
  );
}
