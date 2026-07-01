// Per-section config for the "Materials" profile lists (references, education,
// employment). Each config drives the generic useProfileEntries hook: a blank
// template for new rows, a localStorage sanitizer for hydration, a plain-text
// formatter used for copy/export, and the docx export title/filename.
//
// Pure data + formatting — no React — so the shapes stay easy to test.

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export const REFERENCE_CONFIG = {
  idPrefix: "ref",
  storageKey: "applicationReferences",
  docTitle: "Professional References",
  docFileName: "References.docx",
  blank: () => ({
    name: "",
    title: "",
    company: "",
    relationship: "",
    email: "",
    phone: "",
    notes: "",
  }),
  sanitize: (r) => ({
    id: typeof r.id === "string" && r.id ? r.id : randomId("ref"),
    name: String(r.name || ""),
    title: String(r.title || ""),
    company: String(r.company || ""),
    relationship: String(r.relationship || ""),
    email: String(r.email || ""),
    phone: String(r.phone || ""),
    notes: String(r.notes || ""),
  }),
  formatBlock: (ref) => {
    if (!ref) return "";
    const headerBits = [ref.name, ref.title].filter(Boolean).join(", ");
    const orgLine = [ref.company, ref.relationship].filter(Boolean).join(" — ");
    const lines = [];
    if (headerBits) lines.push(headerBits);
    if (orgLine) lines.push(orgLine);
    if (ref.email) lines.push(`Email: ${ref.email}`);
    if (ref.phone) lines.push(`Phone: ${ref.phone}`);
    if (ref.notes) lines.push(ref.notes);
    return lines.join("\n");
  },
};

export const EDUCATION_CONFIG = {
  idPrefix: "edu",
  storageKey: "applicationEducation",
  docTitle: "Education",
  docFileName: "Education.docx",
  blank: () => ({
    school: "",
    degree: "",
    field: "",
    location: "",
    startDate: "",
    endDate: "",
    gpa: "",
    notes: "",
  }),
  sanitize: (e) => ({
    id: typeof e.id === "string" && e.id ? e.id : randomId("edu"),
    school: String(e.school || ""),
    degree: String(e.degree || ""),
    field: String(e.field || ""),
    location: String(e.location || ""),
    startDate: String(e.startDate || ""),
    endDate: String(e.endDate || ""),
    gpa: String(e.gpa || ""),
    notes: String(e.notes || ""),
  }),
  formatBlock: (entry) => {
    if (!entry) return "";
    const lines = [];
    if (entry.school) lines.push(entry.school);
    const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
    if (degreeLine) lines.push(degreeLine);
    const dateRange = [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
    const metaBits = [entry.location, dateRange].filter(Boolean).join(" • ");
    if (metaBits) lines.push(metaBits);
    if (entry.gpa) lines.push(`GPA: ${entry.gpa}`);
    if (entry.notes) lines.push(entry.notes);
    return lines.join("\n");
  },
};

export const EMPLOYMENT_CONFIG = {
  idPrefix: "emp",
  storageKey: "applicationEmployment",
  docTitle: "Employment History",
  docFileName: "Employment-History.docx",
  max: 4,
  blank: () => ({
    company: "",
    title: "",
    location: "",
    startDate: "",
    endDate: "",
    notes: "",
  }),
  sanitize: (e) => ({
    id: typeof e.id === "string" && e.id ? e.id : randomId("emp"),
    company: String(e.company || ""),
    title: String(e.title || ""),
    location: String(e.location || ""),
    startDate: String(e.startDate || ""),
    endDate: String(e.endDate || ""),
    notes: String(e.notes || ""),
  }),
  formatBlock: (entry) => {
    if (!entry) return "";
    const lines = [];
    const titleLine = [entry.title, entry.company].filter(Boolean).join(" at ");
    if (titleLine) lines.push(titleLine);
    const dateRange = [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
    const metaBits = [entry.location, dateRange].filter(Boolean).join(" • ");
    if (metaBits) lines.push(metaBits);
    if (entry.notes) lines.push(entry.notes);
    return lines.join("\n");
  },
};
