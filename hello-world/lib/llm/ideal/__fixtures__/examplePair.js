// N105 AC-14 - the example posting <-> resume PAIR, as data a test RUNS through
// the real Ideal pipeline (posting -> keyword map -> hypothetical -> application-
// ready). It is shared with N104 (the weakness summary reads the same pair), so it
// holds only plain data: no test imports and no source imports.
//
// Everyone in it is fictional.
//
// THE PAIR
//   EXAMPLE_POSTING          the job posting text the user pasted
//   EXAMPLE_RESUME_TEXT      the user's REAL resume, as the route would read it;
//                            the real material is built from this text alone
//   EXAMPLE_ANALYSIS         what the model's analysis stage returns, in the raw
//                            shape normalizeAnalysis reads: the requirements it
//                            found and the prioritised keyword map (one entry
//                            of each is INVENTED, to be dropped by grounding)
//   EXAMPLE_HYPOTHETICAL_LINES        the best-case resume for this posting; it
//                            is never gated, so it carries every overreach
//   EXAMPLE_CANDIDATE_LINES  the application-ready CANDIDATE, as the model wrote
//                            it: real lines, truthful reframes, and the overreach
//                            the hypothetical taught it
//
// THE ROWS (what the gate must do with each candidate line)
//   mustKeep      a real line, repeated as it stands: it must survive
//   mustSurvive   a truthful reframe (new wording, no new factual token): it must
//                 survive; this is what keeps the gate from degrading into
//                 drop-everything
//   mustDrop      a line the user's material does not support, one per way the
//                 gate or the chronology check can refuse it. `bucket` says where
//                 the pipeline accounts for it ("removed" = anchored in real
//                 material but adds something unverifiable, so the user can
//                 verify and add it back; "leftOut" = nothing supports it) and
//                 `reasonCode` is the gate's reason code for it.
//
// EXAMPLE_CHAIN_ITEM follows ONE posting requirement through all four stages.

export const EXAMPLE_POSTING = [
  "Payments Platform Engineer - Northwind Commerce",
  "",
  "About the role",
  "We are looking for an engineer to build and run the services that process card payments for our merchants.",
  "",
  "What you will do",
  "- Build and operate the checkout service that processes card payments.",
  "- Reduce support load by improving the merchant onboarding flow.",
  "- Own on-call readiness for the billing database, including runbooks.",
  "- Mentor junior engineers through their first production releases.",
  "",
  "What we are looking for",
  "- 3+ years of backend engineering experience.",
  "- Hands-on experience with payment processing, PCI compliance, and Kubernetes.",
  "- A track record of reducing operational cost and incident volume.",
].join("\n");

export const EXAMPLE_RESUME_TEXT = [
  "Jordan Rivera",
  "jordan.rivera@example.com",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Software Engineer, Brightwave Systems | Mar 2020 - Present",
  "- Built the checkout service that processes card payments for 2M customers",
  "- Reduced support tickets by 40% after redesigning the onboarding flow",
  "- Mentored two junior engineers through their first production releases",
  "- Wrote the on-call runbook for the billing database",
  "",
  "Junior Developer, Cobalt Labs | Jun 2017 - Feb 2020",
  "- Maintained the internal reporting dashboard used by 30 analysts",
  "- Automated the monthly invoice export, saving 6 hours each month",
  "",
  "EDUCATION",
  "Lakeview University — B.S. Computer Science (2013-2017)",
].join("\n");

// Stage 1 as the model returns it. The last requirement and the last keyword are
// not in the posting: grounding must remove them (AC-8, AC-9).
export const EXAMPLE_ANALYSIS = {
  jobTitle: "Payments Platform Engineer",
  companyName: "Northwind Commerce",
  requirements: [
    { text: "Build and operate the checkout service that processes card payments.", kind: "responsibility" },
    { text: "Reduce support load by improving the merchant onboarding flow.", kind: "responsibility" },
    { text: "Hands-on experience with payment processing, PCI compliance, and Kubernetes.", kind: "requirement" },
    { text: "Mentor junior engineers through their first production releases.", kind: "responsibility" },
    { text: "Five years of Terraform and Go experience.", kind: "requirement" },
  ],
  keywordMap: [
    { keyword: "payments", section: "headline", priority: 1, requirementIndex: 0 },
    { keyword: "merchant onboarding", section: "experience", priority: 2, requirementIndex: 1 },
    { keyword: "PCI compliance", section: "competencies", priority: 3, requirementIndex: 2 },
    { keyword: "Kubernetes", section: "competencies", priority: 4, requirementIndex: 2 },
    { keyword: "mentoring", section: "summary", priority: 5, requirementIndex: 3 },
    { keyword: "Terraform", section: "competencies", priority: 6, requirementIndex: 4 },
  ],
};

const NAME = "Jordan Rivera";
const CONTACT = "jordan.rivera@example.com";
const BRIGHTWAVE = "Brightwave Systems — Software Engineer (Mar 2020 - Present)";
const COBALT = "Cobalt Labs — Junior Developer (Jun 2017 - Feb 2020)";
const SCHOOL = "Lakeview University — B.S. Computer Science (2013-2017)";

const CHECKOUT = "Built the checkout service that processes card payments for 2M customers";
const RUNBOOK = "Wrote the on-call runbook for the billing database";
const DASHBOARD = "Maintained the internal reporting dashboard used by 30 analysts";
const INVOICE = "Automated the monthly invoice export, saving 6 hours each month";

const ONBOARDING_REFRAME = "Cut support ticket volume by 40% by redesigning the merchant onboarding flow";
const MENTOR_REFRAME = "Coached two junior engineers through their first production releases";

const INFLATED_METRIC = "Scaled the checkout service to process $2B in annual card payments";
const INFLATED_AUTHORITY = "Led the payments engineering team of 12 engineers";
const UNSUPPORTED_CERT = "Achieved PCI DSS compliance for the merchant vault";
const WRONG_EMPLOYER = "Reduced support tickets by 40% after redesigning the onboarding flow";
const INVENTED_EMPLOYER = "Northwind Commerce — Payments Lead (2021-2023)";
const INVENTED_EMPLOYER_BULLET = "Owned the card payments roadmap for the Northwind merchant network";

// The hypothetical's version of the onboarding bullet: the posting's keyword, with
// outcomes the user cannot show.
const HYPOTHETICAL_ONBOARDING =
  "Cut support tickets by 40% and onboarding time by 65% by rebuilding merchant onboarding for 5,000 merchants";

export const EXAMPLE_HYPOTHETICAL_LINES = [
  NAME,
  CONTACT,
  "",
  "PROFESSIONAL EXPERIENCE",
  "Brightwave Systems — Principal Payments Engineer (Mar 2020 - Present)",
  INFLATED_AUTHORITY,
  INFLATED_METRIC,
  UNSUPPORTED_CERT,
  HYPOTHETICAL_ONBOARDING,
  MENTOR_REFRAME,
  CHECKOUT,
  RUNBOOK,
  "",
  "Cobalt Labs — Senior Backend Engineer (Jun 2017 - Feb 2020)",
  WRONG_EMPLOYER,
  DASHBOARD,
  "",
  INVENTED_EMPLOYER,
  INVENTED_EMPLOYER_BULLET,
  "",
  "EDUCATION",
  SCHOOL,
];

export const EXAMPLE_CANDIDATE_LINES = [
  NAME,
  CONTACT,
  "",
  "PROFESSIONAL EXPERIENCE",
  BRIGHTWAVE,
  CHECKOUT,
  ONBOARDING_REFRAME,
  MENTOR_REFRAME,
  RUNBOOK,
  INFLATED_METRIC,
  INFLATED_AUTHORITY,
  UNSUPPORTED_CERT,
  "",
  COBALT,
  DASHBOARD,
  INVOICE,
  WRONG_EMPLOYER,
  "",
  INVENTED_EMPLOYER,
  INVENTED_EMPLOYER_BULLET,
  "",
  "EDUCATION",
  SCHOOL,
];

export const EXAMPLE_ROWS = {
  mustKeep: [NAME, CONTACT, BRIGHTWAVE, CHECKOUT, RUNBOOK, COBALT, DASHBOARD, INVOICE, SCHOOL],
  mustSurvive: [ONBOARDING_REFRAME, MENTOR_REFRAME],
  mustDrop: [
    { id: "inflated-metric", text: INFLATED_METRIC, bucket: "removed", reasonCode: "partial-match" },
    { id: "inflated-authority", text: INFLATED_AUTHORITY, bucket: "removed", reasonCode: "partial-match" },
    { id: "unsupported-certification", text: UNSUPPORTED_CERT, bucket: "leftOut", reasonCode: "no-match" },
    { id: "real-claim-wrong-employer", text: WRONG_EMPLOYER, bucket: "leftOut", reasonCode: "membership" },
    { id: "invented-employer", text: INVENTED_EMPLOYER, bucket: "leftOut", reasonCode: "no-match" },
    { id: "invented-employer-content", text: INVENTED_EMPLOYER_BULLET, bucket: "leftOut", reasonCode: "no-match" },
  ],
};

// ---------------------------------------------------------------------------
// N104 - the same pair, run through weakness summary -> regenerate -> re-review.
//
// THE FIRST PASS is EXAMPLE_CANDIDATE_LINES with ONE line under-weighted: the
// checkout bullet is shortened so it no longer says "payments". The shortened line
// is still supported by the resume (every fact in it is in the real line), so the
// gate keeps it; the posting's first requirement asks for the checkout service that
// processes card payments, and the resume DOES say that, so the reviewer reports
// the keyword "Payments" as missing and the user's material supports it: a gap
// rewording can close. EXAMPLE_CANDIDATE_LINES itself, which keeps the full
// "processes card payments" wording, is the improved draft the regenerate's mock
// engine returns, and it still carries every failable row above, so the run proves
// the regenerate cannot admit them.
//
// THE GAPS (what each class is, on this pair, as the shipped reviewer reports it)
//   mustClose      a posting keyword the resume supports, absent from the first pass
//                  and present in the improved draft: the report must say it is gone
//   mustLeaveOpen  requirements the reviewer finds nothing in the resume to support
//                  (no Kubernetes or PCI; no mentoring in the words the reviewer
//                  reads): they stay open and no line may close them
//   mustConfirm    a finding only the user can verify (the 40% figure has no
//                  baseline): reported, never a target
//   mustNotFabricate  the six failable rows, shared with EXAMPLE_ROWS.mustDrop
const CHECKOUT_UNDERWEIGHTED = "Built the checkout service for 2M customers";

export const EXAMPLE_FIRST_PASS_LINES = EXAMPLE_CANDIDATE_LINES.map((line) =>
  line === CHECKOUT ? CHECKOUT_UNDERWEIGHTED : line,
);

export const EXAMPLE_REGENERATE_ROWS = {
  mustClose: [
    { requirementText: "Build and operate the checkout service that processes card payments.", term: "Payments" },
  ],
  mustLeaveOpen: [
    { requirementText: "Hands-on experience with payment processing, PCI compliance, and Kubernetes.", term: "Kubernetes" },
    { requirementText: "Mentor junior engineers through their first production releases.", term: "Mentoring" },
  ],
  mustConfirm: [{ category: "unverifiable-metric", figure: "40%" }],
  mustNotFabricate: EXAMPLE_ROWS.mustDrop,
};

// One requirement followed through the four stages.
export const EXAMPLE_CHAIN_ITEM = {
  requirementText: "Reduce support load by improving the merchant onboarding flow.",
  keyword: "merchant onboarding",
  keywordSection: "experience",
  hypotheticalBullet: HYPOTHETICAL_ONBOARDING,
  applicationReadyBullet: ONBOARDING_REFRAME,
};
