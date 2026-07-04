// The bundled default library — the canonical seed for new users AND the offline
// fallback when the DB is unreachable/empty. These are the same JSON files the
// engine has always shipped; everything that used to `import x from "../data/x.json"`
// should now read from here so there is one source of truth.
//
// `stopwords` stays bundled-only (not user-editable), per the design.

import taxonomy from "../data/skills_taxonomy.json";
import stopwords from "../data/stopwords.json";
import profile from "../data/profile.json";
import skillGroups from "../data/skill_groups.json";
import contentLibrary from "../data/content_library.json";

// The shape every consumer expects: { taxonomy, stopwords, profile, skillGroups, contentLibrary }.
// `contentLibrary` is the bundle's name for what engine.js historically called `library`
// (content_library.json) — kept distinct here to avoid the overloaded word "library".
// `editRules` (persistent per-user "template" edits) has no bundled default —
// it starts empty and grows only as a user's recurring hand-edits get promoted.
// `personas` (named profile-reframing identities) likewise starts empty per user.
export const defaultLibraryData = Object.freeze({
  taxonomy,
  stopwords,
  profile,
  skillGroups,
  contentLibrary,
  editRules: [],
  personas: [],
});
