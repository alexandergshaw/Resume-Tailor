// Builds a self-contained "javascript:" bookmarklet that, when run on a job
// posting / application page, fills the form's name/email/phone/links fields
// using the supplied profile values.
//
// Browsers forbid a web app from scripting the DOM of a third-party page it
// opens in another tab (cross-origin security). A bookmarklet sidesteps this:
// the user runs it *on* the posting page, so the script executes in that page's
// own context and can fill its inputs.

// The set of autofill fields we know how to map. Keys are matched against an
// input's name/id/aria-label/placeholder/label text (lowercased).
export const AUTOFILL_FIELDS = [
  { key: "firstName", label: "First name", match: ["first name", "firstname", "first_name", "given name", "given-name", "fname"] },
  { key: "lastName", label: "Last name", match: ["last name", "lastname", "last_name", "surname", "family name", "family-name", "lname"] },
  { key: "fullName", label: "Full name", match: ["full name", "your name", "name"] },
  { key: "email", label: "Email", match: ["email", "e-mail"] },
  { key: "phone", label: "Phone", match: ["phone", "mobile", "telephone", "tel"] },
  { key: "location", label: "Location", match: ["location", "city", "address", "town"] },
];

// Returns true if the profile has at least one fillable value.
export function profileHasValues(profile) {
  if (!profile || typeof profile !== "object") return false;
  return AUTOFILL_FIELDS.some((f) => {
    const v = profile[f.key];
    return typeof v === "string" && v.trim().length > 0;
  });
}

// The runtime that executes inside the posting page. Kept as a plain function so
// it can be stringified into the bookmarklet. It receives the profile + the
// field-match config so all knowledge lives in one place.
function autofillRuntime(profile, fieldDefs) {
  function setValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const skipTypes = ["hidden", "password", "file", "submit", "button", "checkbox", "radio", "image", "reset"];
  const controls = document.querySelectorAll("input, textarea");
  let filled = 0;

  controls.forEach((el) => {
    if (el.tagName === "INPUT" && skipTypes.indexOf((el.type || "").toLowerCase()) >= 0) return;
    if (el.disabled || el.readOnly) return;
    if (el.value && el.value.trim()) return; // never overwrite existing input

    let labelText = "";
    if (el.labels && el.labels.length) {
      labelText = el.labels[0].textContent || "";
    }
    const haystack = [
      el.name,
      el.id,
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      labelText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (let i = 0; i < fieldDefs.length; i++) {
      const def = fieldDefs[i];
      const value = profile[def.key];
      if (!value) continue;
      const matched = def.match.some((m) => haystack.indexOf(m) >= 0);
      if (matched) {
        setValue(el, value);
        filled += 1;
        break;
      }
    }
  });

  window.alert("Auto Fill: filled " + filled + " field(s).");
}

// Produce the encoded "javascript:..." string for the given profile.
export function buildBookmarklet(profile) {
  const clean = {};
  for (const f of AUTOFILL_FIELDS) {
    const v = profile && profile[f.key];
    if (typeof v === "string" && v.trim()) clean[f.key] = v.trim();
  }
  const defs = AUTOFILL_FIELDS.map((f) => ({ key: f.key, match: f.match }));
  const body = `(${autofillRuntime.toString()})(${JSON.stringify(clean)},${JSON.stringify(defs)});`;
  return `javascript:${encodeURIComponent(body)}`;
}
