// UI configs for the three profile-list sections rendered by ProfileListSection.
// Behaviour lives in the useProfileEntries controllers; these describe the
// section chrome (labels, empty text, add-button text) and the per-entry field
// layout. Field data shapes are defined in lib/materials/profileEntries.js.

export const REFERENCES_SECTION = {
  label: "References",
  headerId: "references-header",
  noun: "references",
  downloadTitle: "Download references",
  copyAllTitle: "Copy all references",
  emptyText: "No references saved yet. Add one to keep their contact details ready to copy.",
  addLabel: "+ Add reference",
  keyPrefix: "ref",
  headerLabel: (ref) =>
    ref.name?.trim() || ref.title?.trim() || ref.company?.trim() || "Untitled reference",
  fields: [
    { key: "name", label: "Name" },
    { key: "title", label: "Title" },
    { key: "company", label: "Company" },
    { key: "relationship", label: "Relationship" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
  ],
  notesField: { key: "notes", label: "Notes" },
};

export const EDUCATION_SECTION = {
  label: "Education",
  headerId: "education-header",
  noun: "education",
  downloadTitle: "Download education",
  copyAllTitle: "Copy all education",
  emptyText: "No education entries saved yet. Add one to keep your school details ready to copy.",
  addLabel: "+ Add education",
  keyPrefix: "edu",
  headerLabel: (entry) =>
    entry.school?.trim() || entry.degree?.trim() || entry.field?.trim() || "Untitled school",
  fields: [
    { key: "school", label: "School" },
    { key: "degree", label: "Degree" },
    { key: "field", label: "Field of study" },
    { key: "location", label: "Location" },
    { key: "startDate", label: "Start (e.g. Aug 2018)" },
    { key: "endDate", label: "End (e.g. May 2022)" },
    { key: "gpa", label: "GPA" },
  ],
  notesField: { key: "notes", label: "Notes (honors, coursework, activities)" },
};

export const EMPLOYMENT_SECTION = {
  label: "Employment History",
  headerId: "employment-header",
  noun: "employment",
  downloadTitle: "Download employment history",
  copyAllTitle: "Copy all employment",
  emptyText: "No employment entries saved yet. Add up to 4 past employers to keep their details ready to copy.",
  addLabel: "+ Add employer",
  addLabelAtMax: "Max 4 entries reached",
  max: 4,
  keyPrefix: "emp",
  headerLabel: (entry) =>
    entry.title?.trim() || entry.company?.trim() || "Untitled position",
  fields: [
    { key: "company", label: "Company" },
    { key: "title", label: "Job Title" },
    { key: "location", label: "Location" },
    { key: "startDate", label: "Start (e.g. Jan 2020)" },
    { key: "endDate", label: "End (e.g. Mar 2023 or Present)" },
  ],
  notesField: { key: "notes", label: "Notes (responsibilities, achievements)" },
};
