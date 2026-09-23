// N51: the corpora `lib/interviewPrep/interviewerRoles.test.js` measures
// `admitRoleLabel` against. Data only -- no vitest import, no assertions -- so
// the recall numbers can also be reproduced from a plain node script.
//
// WHY THE SLICES ARE REPORTED SEPARATELY. An allow-list's recall measured
// only against titles its own author wrote is a measurement of the author's
// imagination. AC-N51.2 asks for a held-out slice "from a source this AC did
// not write" and plan.r4.md section 6 sets a floor on it. So:
//
//   HELD_OUT  50 job titles that were ALREADY IN THIS REPO before N49, as
//             string literals in other features' fixtures and tests. The 4b
//             seat wrote none of them.
//   AUTHORED  the AC's own must-pass set, plus the interviewer titles a
//             candidate actually meets. Written by this repo's own
//             specifications, and correlated with them by construction --
//             disclosed, and reported on its own line, never merged into the
//             held-out number.
//   OWNER     the role family of the owner's own application (CVS Health,
//             Senior Manager, Application Development). It is the slice that
//             matters most to the person using this and the one the
//             allow-list does worst on.
//   MUST_REFUSE  titles carrying a person's name, in every position
//             AC-N51.3 enumerates. A leak here is a privacy failure, not a
//             quality one, and the floor is zero.
//
// HOW HELD_OUT WAS HARVESTED, so it can be re-run and audited.
//   Root: hello-world/{app,lib,test,scripts,docs}, every .js/.mjs/.json,
//         node_modules and .next excluded. 1,497 files scanned.
//   Pattern: a string literal assigned to one of the keys `title`,
//         `jobTitle`, `job_title`, `role`, `roles`, `headline`, `position`,
//         `positionTitle`, `name`.
//   Filter: 4-70 characters, `^[A-Za-z][A-Za-z0-9&/\-,. ]*$`, at least one
//         space. 332 unique literals survived.
//   Selection: one human question per literal -- "could a person hold this
//         as a job?" -- applied BEFORE `admitRoleLabel` was run on any of
//         them, so the slice cannot have been tuned to the vocabulary. 50
//         qualified. Each row below carries the file the literal came from.
//   Known bias, stated: the "at least one space" filter drops single-word
//         titles, so the slice contains no "Barista" or "Clinician" row.
//         Single-word titles are the shape rules 6 and 8 of design.r3.md
//         section 7.1 are about, and the AUTHORED slice covers them instead.
//
// THE FLOOR IS ON HELD_OUT ONLY. plan.r4.md section 6.2: held-out keep rate
// >= 70%, must-refuse 0 leaks. A drop is a disclosed quality loss (the panel
// shows `rolesDroppedCount`, F-G in PrepPackPanel.n49Frame.test.js); an
// admitted name is not disclosable at all.

/** [title, the repo file the literal was harvested from]. */
export const HELD_OUT_TITLES = [
  ["Adjunct Faculty", "lib/llm/engines/tailor-lite/drupalPosting.test.js"],
  ["Adjunct Faculty, Artificial Intelligence", "lib/llm/engines/tailor-lite/aiPosting.test.js"],
  ["Analyst II", "lib/duplicateApply/verdictPresentation.test.js"],
  ["Asst Director Software Engineering", "lib/llm/engines/tailor-lite/engineeringLeadershipPosting.test.js"],
  ["Backend Engineer", "app/api/copilot/answer/streaming.test.js"],
  ["Building Inspector", "app/api/posting-from-image/route.test.js"],
  ["Cut-Over Specialist", "lib/copilot/resumeAnchor.test.js"],
  ["Data Analyst", "app/copilot/practice/usePracticeSessionLog.test.js"],
  ["Data Engineer", "lib/scrape/fetchUrlContent.test.js"],
  ["Data Scientist", "app/api/interview-prep/route.test.js"],
  ["Director of Campus Culture Change", "lib/llm/engines/tailor-lite/engine.test.js"],
  ["Director of Platform Engineering", "app/api/copilot/answer/route.companyFacts.test.js"],
  ["Drupal and Integrations Developer", "lib/llm/engines/tailor-lite/drupalPosting.test.js"],
  ["Engineering Manager", "app/components/applying/ProfileListSection.touch.test.js"],
  ["Finance Educator", "app/components/library/library.mobile.test.js"],
  ["Frontend Engineer", "app/components/AppViewDialog.prepGenerate.reachability.test.js"],
  ["Frontend Intern", "lib/feed/emailOnlyMatches.test.js"],
  ["Junior Developer", "lib/resume/parseEmployment.test.js"],
  ["Lecturer, Systems Engineering", "lib/llm/engines/tailor-lite/systemsEngineeringPosting.test.js"],
  ["Managed Services Lead", "lib/copilot/resumeAnchor.test.js"],
  ["Office Manager", "lib/scrape/atsLookup.test.js"],
  ["Payments Engineer", "app/api/tailor/route.test.js"],
  ["Platform Engineer", "lib/copilot/applicationDocs.test.js"],
  ["Platform Lead", "app/api/chat/route.promptInjection.test.js"],
  ["Principal Engineer", "app/copilot/useCompanyBrief.test.js"],
  ["Principal Widget Architect", "lib/llm/buildCoverLetterPrompt.test.js"],
  ["Product Curriculum Lead", "lib/copilot/resumeAnchor.test.js"],
  ["Product Manager", "lib/copilot/practiceQuestions.test.js"],
  ["React Engineer", "lib/feed/llmSearch.test.js"],
  ["React Intern", "lib/feed/selectQueueCandidates.test.js"],
  ["Senior Backend Engineer", "lib/copilot/codeLanguagePrompt.test.js"],
  ["Senior Data Engineer", "app/api/chat/route.test.js"],
  ["Senior Data Scientist", "lib/interviewPrep/prepPack.test.js"],
  ["Senior Engineer", "app/api/positions/route.test.js"],
  ["Senior Platform Engineer", "app/api/application-digest/route.test.js"],
  ["Senior React Engineer", "app/components/feed/FeedPostingCard.test.js"],
  ["Senior Software Engineer", "app/api/copilot/answer/route.test.js"],
  ["Software Engineer", "app/api/copilot/question/route.test.js"],
  ["Staff Backend Engineer", "app/api/chat/route.promptInjection.test.js"],
  ["Staff Data Scientist", "lib/scrape/atsLookup.test.js"],
  ["Staff Dispatch Engineer", "lib/copilot/codeLanguagePrompt.test.js"],
  ["Staff Engineer", "app/api/copilot/ask/route.test.js"],
  ["Staff Frontend Engineer", "test/helpers/prepDialogHarness.js"],
  ["Staff Platform Engineer", "lib/feed/postingDescription.test.js"],
  ["Support Analyst", "lib/copilot/resumeAnchor.test.js"],
  ["Temporary Computer Science Developer", "lib/llm/engines/tailor-lite/webDeveloperPosting.test.js"],
  ["UX Engineer", "lib/llm/engines/tailor-lite/uxEngineerPosting.test.js"],
  ["VP of Product", "lib/copilot/resumeAnchor.test.js"],
  ["Web Specialist", "lib/llm/engines/tailor-lite/engine.test.js"],
  ["Widget Engineer", "lib/llm/buildCoverLetterPrompt.test.js"],
];

/** AC-N51.2's must-pass set, verbatim. These are not recall data: every one
 *  of them is a hard requirement, so the test asserts each individually
 *  rather than folding them into a rate. Several are titles this repo's own
 *  name detector flags today (AC finding F4/F5), which is why they are here
 *  at all. */
export const MUST_PASS_TITLES = [
  "Talent Acquisition Partner",
  "Senior Talent Acquisition Partner",
  "Director of Talent Acquisition",
  "Dean of Students",
  "Dean Of Students",
  "Associate Dean",
  "Vice President of Engineering",
  "Customer Success Manager",
  "Regional Manager",
  "General Counsel",
  "Art Director",
  "Chief Nursing Officer",
  "Early Career Recruiter",
  "Brand Team",
  "Director of Engineering",
  "Engineering Manager",
  "Hiring Manager",
  "Recruiter",
  "Technical Recruiter",
  "Recruiting Coordinator",
  "the Platform team",
  "Data Science Team",
  "Department Chair",
  "Search Committee",
  "Head of Product",
  "Staff Engineer",
];

/** Interviewer titles a candidate meets, beyond the must-pass set. AUTHORED
 *  by the 4b seat and correlated with its own expectations -- that is the
 *  whole reason the held-out slice exists, and why this slice's rate is
 *  reported separately and carries no floor. */
export const AUTHORED_TITLES = [
  "Engineering Director",
  "Senior Engineering Manager",
  "Principal Engineer",
  "Staff Software Engineer",
  "Technical Program Manager",
  "Product Designer",
  "Design Lead",
  "Head of Design",
  "Chief Technology Officer",
  "VP of Engineering",
  "Site Reliability Engineer",
  "Security Engineer",
  "Data Platform Engineer",
  "Engineering Team",
  "the Payments team",
  "Platform Team",
  "Recruiting Manager",
  "University Recruiter",
  "Campus Recruiter",
  "People Partner",
  "HR Business Partner",
  "Chief of Staff",
  "Director of Product",
  "Group Product Manager",
  "Software Engineer II",
  "Engineer III",
  "Senior Engineer I",
  "Scrum Master",
  "Chapter Lead",
  "Delivery Manager",
];

/** The owner's own role family: CVS Health, Senior Manager, Application
 *  Development. These are the titles the people interviewing them would
 *  plausibly hold. plan.r4.md section 6 measured 5/12 here, which is the
 *  worst slice in the chunk and the reason backlog B12 exists.
 *
 *  BLIND SPOT, STATED: the owner's actual pack carries no roles at all (a
 *  pre-N49 pack has no such field), and the downloaded prep log carries no
 *  pack content, so "the titles in the owner's own pack" do not exist to be
 *  measured. This slice is that POSTING's role family, not that pack's data. */
export const OWNER_ROLE_FAMILY = [
  "Senior Manager Application Development",
  "Application Development Manager",
  "Director Application Development",
  "Senior Director, Digital Engineering",
  "Pharmacy Technology Lead",
  "Executive Director Technology",
  "Manager Software Engineering",
  "Senior Manager",
  "Engineering Manager",
  "Director of Engineering",
  "Technical Lead",
  "Software Development Manager",
];

/** AC-N51.3's must-refuse shapes: a title combined with a person's name in
 *  every position, plus names built entirely from ambiguous words. The names
 *  are ones this repo's own fixtures already use (the N33 trusted-name tests
 *  and lib/interviewPrep/__fixtures__/predictionCorpus.js), never invented
 *  for this test -- AC-N51.3 asks for exactly that.
 *
 *  The last three rows are the hard ones. "Dean Martinez", "Grant Hill" and
 *  "Chase Taylor" are names whose first word is a job noun, which is the
 *  precise shape that made the N16 wave-G allow-list leak: it overrode the
 *  name detector whenever EITHER word was a job noun. A whole-label rule
 *  refuses them because "Martinez", "Hill" and "Taylor" are not vocabulary. */
export const MUST_REFUSE_LABELS = [
  ["Ana Ruiz, Director of Engineering", "name before the title"],
  ["Director Ana Ruiz", "name after the title"],
  ["Engineering Manager (Jordan Lee)", "parenthetical"],
  ["Priya Shah's team", "possessive"],
  ["the Platform team led by Priya Shah", "led by"],
  ["Recruiter: Emily Nguyen", "colon"],
  ["Sarah from Talent Acquisition", "given name alone"],
  ["Dean Martinez", "ambiguous first word: dean"],
  ["Grant Hill", "ambiguous first word: grant"],
  ["Chase Taylor", "ambiguous first word: chase"],
  ["Sarah Chen", "a bare name"],
  ["Hiring Manager Sarah Chen", "title then name"],
  ["Interview with Dana Whitfield", "prose carrying a name"],
  ["J. Okafor, Recruiter", "initialled name before the title"],
];

/** The names in MUST_REFUSE_LABELS, for the AC-N51.3 requirement that the
 *  screen behaves IDENTICALLY whether or not the candidate stored them as
 *  trusted interviewer names. The screen takes no `storedNames` argument at
 *  all, which is how that is made impossible rather than merely forbidden --
 *  the arity assertion in the test is the instrument, and this list is what
 *  makes the claim concrete. */
export const STORED_NAMES = [
  "Ana Ruiz",
  "Jordan Lee",
  "Priya Shah",
  "Emily Nguyen",
  "Sarah Chen",
  "Dana Whitfield",
  "J. Okafor",
  "Dean Martinez",
  "Grant Hill",
  "Chase Taylor",
];
