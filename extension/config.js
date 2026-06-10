// Origin of your deployed Resume Tailor app, used by the "Sync from Resume
// Tailor" button to pull your saved autofill profile from GET /api/user-profile.
//
// IMPORTANT: also add this origin (with a /* suffix) to "host_permissions" in
// manifest.json so the extension is allowed to fetch it with your session
// cookie. Example for production:
//   APP_ORIGIN below          -> "https://your-app.vercel.app"
//   manifest host_permissions -> "https://your-app.vercel.app/*"
//
// For local development the defaults below target http://localhost:3000.
export const APP_ORIGIN = "http://localhost:3000";
