// The function injected into the active posting/application page to fill its
// form fields. Ported almost verbatim from `autofillRuntime` in
// hello-world/lib/autofill/buildBookmarklet.js.
//
// IMPORTANT: this function is serialized and injected via
// chrome.scripting.executeScript({ func, args }). It must be fully
// self-contained — it may only reference its own parameters and page globals
// (window/document). Do not reference module-scope variables here.
export function autofillRuntime(profile, fieldDefs) {
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

  // Lightweight, self-removing toast instead of the bookmarklet's alert().
  try {
    const toast = document.createElement("div");
    toast.textContent = "Resume Tailor: filled " + filled + " field(s)";
    toast.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "bottom:16px",
      "right:16px",
      "padding:10px 14px",
      "background:#1976d2",
      "color:#fff",
      "font:600 13px system-ui,sans-serif",
      "border-radius:8px",
      "box-shadow:0 4px 12px rgba(0,0,0,.25)",
    ].join(";");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  } catch {
    // body may not be ready; filling already happened
  }

  return filled;
}
