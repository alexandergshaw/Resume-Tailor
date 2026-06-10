# Resume Tailor Autofill (browser extension)

A small Manifest V3 extension that fills job‑application forms on any posting page
using your saved Resume Tailor autofill profile. It replaces the copy‑paste
bookmarklet flow: open a posting, click the extension, and the form fills.

The form‑matching logic is ported from
`hello-world/lib/autofill/buildBookmarklet.js`, and the profile keys match the
app's `GET/PUT /api/user-profile` endpoint
(`hello-world/app/api/user-profile/route.js`).

## What it does

- **Save a profile** locally (in `chrome.storage.local`) from the popup form.
- **Fill this page** — injects the autofill runtime into the active tab and fills
  matching name/email/phone/location/links fields (never overwrites filled
  inputs; skips hidden/file/submit fields).
- **Sync from Resume Tailor** — pulls your saved profile from the app's
  `GET /api/user-profile` so you don't re‑enter it.

## Load it (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on (top‑right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the extension from the toolbar puzzle icon for quick access.

That's it — no build step. After editing any file, click the **reload** icon on
the extension card in `chrome://extensions`.

## Configure the app origin (for Sync)

By default the extension talks to `http://localhost:3000`. To point it at your
deployed app:

1. Edit `config.js` and set `APP_ORIGIN` to your app's origin, e.g.
   `https://your-app.vercel.app`.
2. Edit `manifest.json` → `host_permissions` and add the same origin with a `/*`
   suffix, e.g. `"https://your-app.vercel.app/*"`.
3. Reload the extension.

> The sync request is sent with your session cookie (`credentials: "include"`).
> You must be signed in to the app in the same browser. Because the app's auth
> cookie may be `SameSite=Lax`, sync works most reliably right after you've used
> the app in that browser session; if sync returns "Not signed in", open the app,
> sign in, then try again.

## Files

- `manifest.json` — MV3 manifest (permissions: `storage`, `activeTab`,
  `scripting`; `host_permissions` for the app origin).
- `popup/` — the toolbar popup (form, Save, Sync, Fill this page).
- `content/autofill.js` — the function injected into the page to fill fields
  (ported from the app's bookmarklet runtime).
- `shared/fields.js` — the field config (keys + match tokens), kept in sync with
  the app's `AUTOFILL_FIELDS` / `ALLOWED_KEYS`.
- `config.js` — `APP_ORIGIN` for the Sync feature.

## Notes / limitations

- Uses a **generic** field matcher. Quirky boards (Greenhouse/Lever/Workday) with
  custom React widgets, multi‑step forms, or file uploads are only partially
  handled — per‑board tuning is a future step.
- Restricted pages (`chrome://`, the Web Store, PDF viewer) can't be filled by
  design.
- Load‑unpacked / personal use only; not packaged for the Chrome Web Store.
