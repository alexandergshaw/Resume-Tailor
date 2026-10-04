// The package's consumed public surface: the one analyzer plus the two enums a
// consumer legitimately switches on. The detectors, the reference selector and
// the validators stay in their own files (the unit tests deep-import them) and
// are deliberately NOT re-exported, so a consumer can reach exactly one analyzer.
export { reviewDocuments } from "./reviewDocuments.js";
export { CATEGORY, ORIGIN } from "./contract.js";
