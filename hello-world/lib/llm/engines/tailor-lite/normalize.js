// Placeholder-name normalization, shared by the scanner and the strategy mapper.
//
// Strip braces, uppercase, collapse every run of non-alphanumeric characters to
// a single "_", and trim leading/trailing underscores. This makes the messy
// variety of human-typed placeholders converge on stable UPPER_SNAKE_CASE keys:
//
//   "{{Role-Specific Expertise }}" -> "ROLE_SPECIFIC_EXPERTISE"
//   "{Area of Emphasis}"           -> "AREA_OF_EMPHASIS"
//   "{{ years_of_experience }}"    -> "YEARS_OF_EXPERIENCE"
export function normalizeName(raw) {
  return String(raw == null ? "" : raw)
    .replace(/[{}]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Slot keys are "<NORMALIZED_NAME>::<occurrence>". Occurrence counts per
// normalized name in document order (0-based), so five identical
// {{SKILLS_LINE}} placeholders become SKILLS_LINE::0 .. SKILLS_LINE::4.
export function slotKey(name, occurrence) {
  return `${name}::${occurrence}`;
}
