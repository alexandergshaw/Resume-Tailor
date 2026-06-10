// Field config for the Resume Tailor autofill extension.
//
// SOURCE OF TRUTH: this mirrors AUTOFILL_FIELDS in
// hello-world/lib/autofill/buildBookmarklet.js and the ALLOWED_KEYS allowlist in
// hello-world/app/api/user-profile/route.js. The app and the extension run in
// different build contexts (Next.js app vs. an unbundled MV3 extension), so the
// config is copied here rather than imported. Keep the keys in sync with the app
// — the API only accepts these keys.
//
// We intentionally include linkedin/github/website here (the API allows them)
// even though the app's bookmarklet config omits them, so the extension can fill
// those fields too.
export const AUTOFILL_FIELDS = [
  { key: "firstName", label: "First name", match: ["first name", "firstname", "first_name", "given name", "given-name", "fname"] },
  { key: "lastName", label: "Last name", match: ["last name", "lastname", "last_name", "surname", "family name", "family-name", "lname"] },
  { key: "fullName", label: "Full name", match: ["full name", "your name", "name"] },
  { key: "email", label: "Email", match: ["email", "e-mail"] },
  { key: "phone", label: "Phone", match: ["phone", "mobile", "telephone", "tel"] },
  { key: "location", label: "Location", match: ["location", "city", "address", "town"] },
  { key: "linkedin", label: "LinkedIn", match: ["linkedin", "linked-in"] },
  { key: "github", label: "GitHub", match: ["github", "git hub"] },
  { key: "website", label: "Website", match: ["website", "portfolio", "personal site", "url", "web site"] },
];

// Plain {key: match[]} list passed to the injected autofill runtime.
export const FIELD_DEFS = AUTOFILL_FIELDS.map((f) => ({ key: f.key, match: f.match }));
