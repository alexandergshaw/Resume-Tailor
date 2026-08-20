// Registry of professional "registers" behind the /copilot "Speak as" drill
// (AC-Q1). A register is everything that makes one profession sound like
// itself out loud: its cadence, its terms of art, the phrases a person who
// actually does the job would never say, and the shape (in order) of a
// strong answer. This file is the single source of truth for that content -
// the situation bank in roleSituationBank.js, the deterministic answer
// drafter in roleResponse.js, and the Gemini prompts built in
// app/api/copilot/role-*/route.js all import their vocabulary from here
// instead of re-declaring it, exactly the way lib/copilot/interviewTypes.js
// is the one place an interview format is defined.
//
// The whole point of the drill is that a manager and a clinician must not
// sound alike. Concretely that means: no two roles may share `guidance`,
// cross-role `vocabulary` overlap is capped (checked by the contract test),
// and every `avoid` phrase is a literal, quotable fragment - not a
// description of a mistake - because the response route (wave 2b) rejects
// any drafted answer that contains one verbatim. Terms of art here are real
// professional usage, not invented jargon; where a term's meaning is not
// obvious from the word itself, `signals` states what using it actually
// communicates, in plain language.
//
// Deliberately data plus pure functions only: no React, no DOM, no
// network, no randomness, no wall-clock reads. Every export is a straight
// function of its argument, safe to call from a route handler, a client
// component, or a unit test with no setup.
//
// `guidance` is injected verbatim into an LLM prompt and is also compared
// character-for-character against the prompt actually sent in route tests,
// so - like interviewTypes.js - it is built by `+`-concatenating single-line
// fragments: no fragment may contain a newline or a `"` character, and the
// joined result never does either.

export const DEFAULT_ROLE = "manager";

export const ROLE_REGISTERS = [
  {
    value: "manager",
    label: "People manager",
    blurb: "A people manager checking in with a direct report, and answering upward to their own manager.",
    guidance:
      "You are a people manager speaking with a direct report or with your own manager about a real " +
      "problem on your team. Own the outcome in the first person, name the specific next step and who " +
      "is responsible for it, and never let a team miss read as one person's fault in front of others.",
    cadence: [
      "Open with the headline fact before any softening, so the message lands in the first sentence.",
      "Use 'we' for team outcomes and 'I' when owning your own call - never blur the two.",
      "Slow down on the plan and the dates; that is the part people actually need to write down.",
      "Leave a short beat of silence after bad news before moving straight into next steps.",
    ],
    vocabulary: [
      { term: "1:1", signals: "confidential coaching time with a report, not a status update for the group" },
      { term: "backfill", signals: "you are managing headcount risk, not just praising the person who is leaving" },
      { term: "escalate", signals: "you are naming who owns the decision above you, not passing along blame" },
      { term: "scope creep", signals: "the plan changed after commitment, not that the team is working slowly" },
      { term: "blocker", signals: "something outside this person's control is stopping the work from moving" },
      { term: "headcount", signals: "you are talking about budgeted roles, not just bodies currently in seats" },
      { term: "action item", signals: "a specific owner and a deadline exist, not just a vague good intention" },
      { term: "stakeholder", signals: "someone outside the team whose sign-off the plan actually depends on" },
    ],
    avoid: [
      { phrase: "that's not my problem", why: "a manager owns problems that touch their team, not just their own tasks" },
      { phrase: "figure it out yourselves", why: "abandons the coaching and support a manager is there to provide" },
      { phrase: "you guys dropped the ball", why: "blames the team collectively instead of owning the call as the manager" },
      { phrase: "I don't have time for this", why: "dismisses a report's real problem instead of triaging it" },
    ],
    beatLabels: ["Name the facts", "Own the miss", "State the plan", "Set the checkpoint"],
    fallbackBeats: [
      "I want to name the facts plainly: this slipped because of something outside the team's control, not effort.",
      "I'm not going to let this read as one person's fault - I own the call I made here, plainly and out loud.",
      "Here's my plan: I'm turning this into one clear action item, with an owner and a date, starting today.",
      "I'll check in with you at our next 1:1, and if anything new comes up, I'm raising it immediately.",
    ],
  },
  {
    value: "executive",
    label: "Executive",
    blurb: "A C-suite executive briefing the board, investors, or the whole company on where things stand.",
    guidance:
      "You are a company executive speaking to the board, investors, or the whole organization about " +
      "performance, risk, or a hard call you are making. Lead with the headline number or decision " +
      "before the context, speak in ranges rather than false certainty, and never promise an outcome " +
      "you cannot actually guarantee.",
    cadence: [
      "Lead with the number or the outcome in the first breath; context comes after it, not before.",
      "Keep sentences short enough to survive being quoted back verbatim in a board deck.",
      "Speak in probabilities and ranges, not false certainty, whenever the outcome is not locked yet.",
      "Slow down only on the ask - what you actually need from the room - and say it once, plainly.",
    ],
    vocabulary: [
      { term: "runway", signals: "how many months of cash remain before a hard decision is forced" },
      { term: "OKRs", signals: "the objective is measured against stated key results, not just aspirational" },
      { term: "headwinds", signals: "the pressure is coming from outside the company, not a performance failure" },
      { term: "guidance", signals: "a forward-looking number the market or board will hold the company to" },
      { term: "board", signals: "a decision needs formal governance sign-off, not just leadership consensus" },
      { term: "P&L", signals: "you are speaking in terms of revenue against cost, not raw activity" },
      { term: "north star", signals: "the one metric everything else in the plan is meant to serve" },
      { term: "capital allocation", signals: "a choice about where scarce investment dollars go, and where they do not" },
    ],
    avoid: [
      { phrase: "we'll figure it out later", why: "an executive owes the room a plan, not a deferral on a material question" },
      { phrase: "trust me on this", why: "asks for confidence without giving the number or reasoning behind it" },
      { phrase: "that's above my pay grade", why: "undermines the accountability the room expects from an executive" },
      { phrase: "let's not tell the board yet", why: "withholds material information from the governance body owed it" },
    ],
    beatLabels: ["Lead with the number", "Name the driver", "State the ask", "Commit the timeline"],
    fallbackBeats: [
      "Let me lead with the number: here's exactly where we stand today, stated plainly before any context.",
      "I can point to specific headwinds driving this, not a vague reference to a difficult market.",
      "My ask is one clear decision or resource I need from you today, not a menu of options.",
      "I'll commit to a real date for the next milestone, and I will report back against it myself.",
    ],
  },
  {
    value: "professor",
    label: "Professor",
    blurb: "A tenure-track professor talking with a student, a colleague, or a department committee.",
    guidance:
      "You are a professor speaking with a student, a colleague, or a department committee about a " +
      "grade, a research question, or an academic standard. Explain the reasoning behind the standard " +
      "rather than just citing the rule, treat the question as legitimate even if you have heard it " +
      "before, and never let the rigor of your answer depend on how senior the person asking happens " +
      "to be.",
    cadence: [
      "Take the question seriously before answering it, even one you have heard a hundred times before.",
      "Explain the reasoning, not just the rule, so the standard doesn't sound arbitrary.",
      "Pause to let a definition land before building the next idea on top of it.",
      "Match formality to the room: office hours run looser than a committee meeting does.",
    ],
    vocabulary: [
      { term: "tenure", signals: "a permanent faculty appointment with academic-freedom protections attached" },
      { term: "peer review", signals: "the work has been vetted by other experts before anyone is asked to trust it" },
      { term: "office hours", signals: "dedicated, unhurried time set aside specifically for a student's questions" },
      { term: "syllabus", signals: "the course's binding contract with students on grading and expectations" },
      { term: "rubric", signals: "the grade traces to stated criteria, not to the grader's mood that day" },
      { term: "academic integrity", signals: "the concern is honest authorship, not simply a disappointing grade" },
      { term: "IRB", signals: "human-subjects research that must clear an ethics review before it can start" },
      { term: "literature review", signals: "the claim is situated against what has already been published" },
    ],
    avoid: [
      { phrase: "just wing the citation", why: "treats academic integrity as optional instead of foundational" },
      { phrase: "grades are basically arbitrary", why: "undermines the rubric-based system the professor is bound by" },
      { phrase: "I'll bump your grade for you", why: "bypasses the documented grading process without cause" },
      { phrase: "that paper wasn't worth reading", why: "dismisses a colleague's or student's work unprofessionally" },
    ],
    beatLabels: ["State the standard", "Explain the reasoning", "Offer the path forward", "Set the follow-up"],
    fallbackBeats: [
      "Let me state the standard plainly: this is the same rubric I apply to everyone, not an improvised call.",
      "I want to explain the reasoning behind it, not just cite the rule, so it doesn't sound arbitrary to you.",
      "I can offer you a real path forward here, whether that's a resubmission, an appeal, or a specific step.",
      "I'll follow up with you directly, whether that's office hours or a written note on where the rubric applies.",
    ],
  },
  {
    value: "clinician",
    label: "Clinician",
    blurb: "A clinician explaining a diagnosis, a risk, or a plan directly to a patient or their family.",
    guidance:
      "You are a clinician speaking directly with a patient or their family about a diagnosis, a risk, " +
      "or a plan of care. State the assessment in plain language before the caveats, check that the " +
      "patient actually understood what you said, and never offer reassurance that is not backed by an " +
      "actual finding.",
    cadence: [
      "State the assessment plainly before the caveats, so the patient hears the answer first.",
      "Slow down and use plain language for anything that will change what the patient does next.",
      "Check understanding out loud rather than assuming a nod means comprehension.",
      "Keep reassurance tied to evidence you actually have; never offer it on its own.",
    ],
    vocabulary: [
      { term: "differential diagnosis", signals: "you are weighing several explanations, not announcing one final answer" },
      { term: "chief complaint", signals: "the patient's own words about why they came in today, verbatim" },
      { term: "informed consent", signals: "the patient understood the risks before agreeing to proceed" },
      { term: "scope of practice", signals: "what you are licensed to decide versus what needs a referral out" },
      { term: "handoff", signals: "responsibility for the patient is formally transferring to someone else" },
      { term: "adverse event", signals: "a documented harm that occurred during care, not merely a complaint" },
      { term: "standard of care", signals: "what a reasonably competent clinician would have done in this situation" },
      { term: "triage", signals: "urgency is being ranked before anything else about the case is decided" },
    ],
    avoid: [
      { phrase: "it's probably nothing", why: "offers false reassurance before any real workup has been done" },
      { phrase: "you're fine, don't worry", why: "asserts certainty the clinician does not actually have yet" },
      { phrase: "I'm sure it's not serious", why: "overpromises a diagnosis ahead of the evidence" },
      { phrase: "let's not chart that", why: "skipping documentation is a real, serious clinical violation" },
    ],
    beatLabels: ["State the assessment", "Explain the risk", "Give the plan", "Confirm understanding"],
    fallbackBeats: [
      "Let me tell you the assessment plainly: here's what I know so far, and here's what is still uncertain.",
      "I want you to understand the real risk here, based on what the differential diagnosis actually shows.",
      "Here's my plan: one specific next step, whether that's a test, a referral, or a change to your treatment.",
      "I want you to say the plan back to me in your own words, so I know we're truly on the same page.",
    ],
  },
  {
    value: "attorney",
    label: "Attorney",
    blurb: "An attorney advising a client, and speaking carefully because the words may end up in the record.",
    guidance:
      "You are an attorney advising a client about a legal matter, aware that anything you say may end " +
      "up quoted back in an email or a filing. State your position and the basis for it in that order, " +
      "hedge only where the law itself is genuinely uncertain, and never guarantee an outcome a court or " +
      "counterparty ultimately controls.",
    cadence: [
      "State your position first, then the basis for it, in that order, every time.",
      "Hedge only where the law genuinely hedges; false confidence and false doubt are both a disservice.",
      "Slow down on anything that will end up in the record or in a written email.",
      "Keep client-facing language plain; save the citations for the brief itself.",
    ],
    vocabulary: [
      { term: "privilege", signals: "a communication is protected from discovery and must not be shared casually" },
      { term: "discovery", signals: "the formal exchange of evidence before trial, not a casual document request" },
      { term: "on the record", signals: "the statement is attributable and can be used against someone later" },
      { term: "conflict of interest", signals: "a duty to one client is competing with another interest here" },
      { term: "statute of limitations", signals: "a hard deadline after which a claim can no longer be brought" },
      { term: "burden of proof", signals: "who has to prove their case, and to what evidentiary standard" },
      { term: "retainer", signals: "the fee arrangement that formally puts the attorney on the matter" },
      { term: "liability", signals: "legal responsibility for harm, distinct from simple moral fault" },
    ],
    avoid: [
      { phrase: "I guarantee we'll win", why: "attorneys are barred from guaranteeing a litigation outcome" },
      { phrase: "just email that over to them", why: "risks waiving privilege on a protected communication" },
      { phrase: "we can worry about discovery later", why: "mishandles a formal process with real deadlines" },
      { phrase: "it's basically the same as last time", why: "treats a distinct matter as generic instead of on its facts" },
    ],
    beatLabels: ["State the position", "Cite the basis", "Flag the exposure", "Recommend next step"],
    fallbackBeats: [
      "My position is this: here's exactly where we stand, stated plainly before anything else.",
      "The basis for that is a specific fact I can point to, not just my own confidence about the liability.",
      "I want to flag the exposure directly rather than let you find out about it later: here is the real risk.",
      "My recommendation is a specific next step, and I'll tell you exactly who is responsible and by when.",
    ],
  },
  {
    value: "consultant",
    label: "Consultant",
    blurb: "A management consultant presenting findings and a recommendation to a client's leadership team.",
    guidance:
      "You are a management consultant presenting a finding and a recommendation to a client's " +
      "leadership team. Lead with the answer before the analysis behind it, structure the reasoning out " +
      "loud so the logic is easy to follow, and never present a recommendation that is not actually " +
      "backed by the evidence you gathered.",
    cadence: [
      "Lead with the answer, then the evidence - the 'so-what' before the analysis behind it.",
      "Signal structure out loud, such as naming three drivers before you actually name them.",
      "Keep the client's own words in the room; reflect their language back before you reframe it.",
      "Land the recommendation as a decision to make, not a menu of options to admire.",
    ],
    vocabulary: [
      { term: "deliverable", signals: "a specific artifact the client is paying for, not general advice in the room" },
      { term: "workstream", signals: "one defined thread of the engagement with its own owner and timeline" },
      { term: "hypothesis-driven", signals: "you tested a specific guess against data instead of exploring blindly" },
      { term: "MECE", signals: "the options are broken down without overlap and without any gaps" },
      { term: "so-what", signals: "the analysis has to end in a stated implication, not stop at a bare finding" },
      { term: "stakeholder buy-in", signals: "the recommendation only works if the right people actually agree to it" },
      { term: "engagement", signals: "the defined, time-boxed piece of client work the firm was hired for" },
      { term: "scope", signals: "the boundary of what the engagement covers, and what it explicitly does not" },
    ],
    avoid: [
      { phrase: "trust the gut on this one", why: "abandons the hypothesis-driven, evidence-based method clients pay for" },
      {
        phrase: "we don't really have the data, but let's go with it",
        why: "presents an unsupported number as final instead of pausing to revise the recommendation",
      },
      { phrase: "just copy what we did last time", why: "treats a distinct client's problem as generic, not tailored" },
      { phrase: "the client won't notice", why: "unprofessional disregard for the client's own stake in the work" },
    ],
    beatLabels: ["Name the finding", "Show the evidence", "Give the recommendation", "Define the next step"],
    fallbackBeats: [
      "Let me name the finding first: here's the clear conclusion, before I walk you through the analysis.",
      "I can show you the evidence - a specific number or pattern from the actual engagement, not an assertion.",
      "My recommendation is a single clear choice, and I'm not handing you a menu with no point of view.",
      "I'll define the next step with an owner and a date, so this doesn't stall the moment we leave the room.",
    ],
  },
  {
    value: "tech-lead",
    label: "Tech lead",
    blurb: "An engineering tech lead updating their team and stakeholders during or after an incident.",
    guidance:
      "You are an engineering tech lead updating your team or stakeholders about an incident, a " +
      "technical risk, or a design decision. Open with the user-facing impact before the technical " +
      "detail, separate what is confirmed from what is still being investigated, and never assign blame " +
      "to one engineer in a conversation meant to fix a system.",
    cadence: [
      "Open with user impact and scope before the technical narrative of what happened.",
      "Narrate the timeline in order - detection, mitigation, fix - so the sequence is auditable.",
      "Separate what is known from what is still being verified; do not blend the two together.",
      "Close every update with the next checkpoint, even if it is simply 'still investigating'.",
    ],
    vocabulary: [
      { term: "postmortem", signals: "a blameless written account of what happened after an incident" },
      { term: "blast radius", signals: "how much of the system a change or failure can actually reach" },
      { term: "technical debt", signals: "a shortcut taken deliberately, with a cost that compounds over time" },
      { term: "on-call", signals: "who is responsible for responding right now if something breaks" },
      { term: "root cause", signals: "naming the underlying failure, not just the symptom noticed first" },
      { term: "rollback", signals: "reverting to the last known-good state instead of forward-fixing under pressure" },
      { term: "code review", signals: "a second engineer verified the change before it shipped" },
      { term: "single point of failure", signals: "one component whose failure would take the whole system down" },
    ],
    avoid: [
      { phrase: "let's just skip the review", why: "removes the second set of eyes the team relies on before shipping" },
      { phrase: "it's a quick hotfix, no rollback needed", why: "removes the safety net a fast change under pressure needs most" },
      { phrase: "whoever wrote this is an idiot", why: "blames an individual in what is meant to be a blameless review" },
      { phrase: "ship it and see what breaks", why: "abandons the testing and review discipline the role is trusted with" },
    ],
    beatLabels: ["State the impact", "Name the root cause", "Give the fix", "Commit to follow-up"],
    fallbackBeats: [
      "Let me state the impact first, in plain terms, before I get into any technical detail.",
      "I can name the root cause based on what's actually confirmed so far, separate from what's still a guess.",
      "Here's my fix: a specific, testable change, not a vague promise that I'll look into it.",
      "I'm committing to a real follow-up, even if that commitment right now is naming our next check-in time.",
    ],
  },
  {
    value: "account-executive",
    label: "Account executive",
    blurb: "A sales account executive talking with a prospect who has not yet signed.",
    guidance:
      "You are a sales account executive talking with a prospect who has not yet signed a contract. " +
      "Confirm what the prospect actually needs before defending your price or your product, treat a " +
      "real objection as information rather than an obstacle to talk over, and never promise a feature " +
      "or a timeline your own product team has not committed to.",
    cadence: [
      "Mirror the prospect's own words before reframing the value; do not lead with your deck.",
      "Ask before you pitch - confirm what they actually need before you defend the price.",
      "Keep energy up, but let a real objection sit for a second before you answer it.",
      "Always close with a specific next step and a date, never a vague 'let's stay in touch'.",
    ],
    vocabulary: [
      { term: "pipeline", signals: "the set of deals in progress, ranked by how likely each is to close" },
      { term: "quota", signals: "the revenue target you are personally held to this period" },
      { term: "champion", signals: "an internal advocate at the prospect who sells on your behalf when you are not in the room" },
      { term: "procurement", signals: "the buyer's internal process for approving and signing a contract" },
      { term: "discovery call", signals: "the early call where you learn the prospect's actual problem, not pitch yet" },
      { term: "objection handling", signals: "a structured response to a stated reason not to buy, not a brush-off" },
      { term: "ARR", signals: "recurring revenue counted on an annualized basis, the metric leadership tracks" },
      {
        term: "MEDDPICC",
        signals: "MEDDIC's qualification checkpoints plus paper process and competition, for complex enterprise deals",
      },
    ],
    avoid: [
      { phrase: "I'll just promise them anything", why: "sets up a broken commitment the product team never agreed to" },
      { phrase: "we'll throw in whatever they want", why: "desperate discounting that undermines the product's value" },
      { phrase: "our competitor's product is garbage", why: "unprofessional badmouthing instead of a value-based case" },
      { phrase: "just sign now, we'll sort details later", why: "pressures the prospect instead of earning informed consent" },
    ],
    beatLabels: ["Acknowledge the ask", "Reframe the value", "Handle the objection", "Close on next step"],
    fallbackBeats: [
      "I hear what you're asking for, and I want to acknowledge it directly before we go any further.",
      "Let me reframe the value around what you actually need, not a generic list of features I'd otherwise pitch.",
      "I'm not going to talk over your objection - my objection handling here is answering it directly.",
      "I'll close this with one specific next step and an actual date, not a vague promise to stay in touch.",
    ],
  },
  {
    value: "teacher",
    label: "Teacher",
    blurb: "A K-12 teacher talking with a student or a parent about how that student is doing.",
    guidance:
      "You are a K-12 teacher talking with a student or a parent about how that student is doing in " +
      "class. State what actually happened before any judgment about it, keep the same respect and " +
      "patience for a struggling student that you would show a fast one, and never let a single " +
      "student's setback become a public comparison in front of the class.",
    cadence: [
      "Name what happened factually before any judgment, especially with a parent listening.",
      "Slow down for a struggling student the same way you would for a fast one - same respect, different pace.",
      "Keep language age-appropriate without becoming vague about what is actually expected.",
      "End on the next concrete step, not a general instruction to 'try harder'.",
    ],
    vocabulary: [
      { term: "IEP", signals: "a legally binding plan of accommodations for a student with a disability" },
      { term: "differentiation", signals: "the same lesson taught through different paths for different learners" },
      { term: "formative assessment", signals: "a check for understanding used to adjust teaching, not to grade" },
      { term: "classroom management", signals: "the structures that keep instruction time actually usable" },
      { term: "parent-teacher conference", signals: "a scheduled, two-way conversation about one specific student's progress" },
      { term: "scaffolding", signals: "temporary support that is deliberately removed as a student gains skill" },
      { term: "rubric", signals: "the grade traces to stated criteria the student saw in advance" },
      { term: "standards-aligned", signals: "the lesson maps to a specific, externally set learning standard" },
    ],
    avoid: [
      { phrase: "they're just not a math person", why: "labels a child with a fixed mindset instead of naming a fixable gap" },
      { phrase: "that's not my problem, talk to the principal", why: "deflects a professional duty owed to the student" },
      { phrase: "I don't have time to differentiate", why: "dismisses an obligation to reach every learner in the room" },
      { phrase: "everyone else gets it, why don't you", why: "shames a struggling student in front of peers" },
    ],
    beatLabels: ["Name what happened", "Explain the standard", "Offer the support", "Set the next step"],
    fallbackBeats: [
      "Let me tell you what happened, factually, before any judgment about it.",
      "I want to name the standard I'm applying here plainly, so the expectation is clear, not a moving target.",
      "I can offer you real support here, matched to what you specifically need, built with some scaffolding.",
      "I'll set a concrete next step with you, with an actual date attached, not a vague plan to improve.",
    ],
  },
  {
    value: "people-ops",
    label: "People ops",
    blurb: "A people-ops (HR) partner explaining a policy or a process to an employee or a manager.",
    guidance:
      "You are a people-ops partner explaining a policy, an accommodation, or an investigation step to " +
      "an employee or a manager. State the policy plainly before the empathy so the boundary is clear, " +
      "say exactly what you can and cannot promise about confidentiality, and never give legal advice or " +
      "bypass the documented process because a situation feels urgent.",
    cadence: [
      "State the policy plainly before the empathy, so the boundary is clear from the start.",
      "Keep language even and procedural; this is not the place for a personal opinion out loud.",
      "Say what you can and cannot promise about confidentiality before anyone assumes either.",
      "Close every conversation with the actual next step and who owns it.",
    ],
    vocabulary: [
      {
        term: "PIP",
        signals: "a formal, documented process most employers require before exiting someone for performance",
      },
      { term: "protected class", signals: "a legal category where employment decisions face heightened scrutiny" },
      { term: "at-will employment", signals: "either party can end employment at any time, within legal limits" },
      { term: "reasonable accommodation", signals: "a legally required adjustment for a disability or religious need" },
      { term: "exit interview", signals: "a structured conversation to learn why someone is actually leaving" },
      { term: "engagement survey", signals: "company-wide sentiment data used to track morale over time" },
      { term: "compensation band", signals: "the approved pay range for a role, not a number one person invented" },
      { term: "policy exception", signals: "a deviation from standard policy that has to be approved and documented" },
    ],
    avoid: [
      { phrase: "this stays totally confidential", why: "HR cannot ethically promise absolute confidentiality" },
      { phrase: "just let it go this time", why: "bypasses the documented policy and process HR is there to protect" },
      { phrase: "that's basically illegal, sue them", why: "gives legal advice, which is outside a people-ops partner's role" },
      { phrase: "we'll just quietly manage them out", why: "circumvents fair process and creates real legal exposure" },
    ],
    beatLabels: ["State the policy", "Give the rationale", "Protect the process", "Confirm next step"],
    fallbackBeats: [
      "Let me state the policy plainly, in its actual terms, before I offer any reassurance.",
      "I can give you the rationale behind it, including exactly why it applies in this situation.",
      "I'm going to protect the process here - if this is a PIP situation, we follow it exactly as written.",
      "I'll confirm the next step with you now, along with exactly who owns it and what happens next.",
    ],
  },
];

export const ROLE_VALUES = ROLE_REGISTERS.map((r) => r.value);

// value -> descriptor, built once so every consumer sees the exact same
// object per role rather than a fresh copy on each call.
const BY_VALUE = new Map(ROLE_REGISTERS.map((r) => [r.value, r]));

// Maps any untrusted input (a route body, a localStorage read, a stale
// cached value) to a known role value, defaulting to DEFAULT_ROLE for
// anything not in the vocabulary above - missing, empty, wrong type,
// mixed case, surrounding whitespace, or simply unrecognized. Never throws.
export function normalizeRole(value) {
  if (typeof value !== "string") return DEFAULT_ROLE;
  const key = value.trim().toLowerCase();
  return BY_VALUE.has(key) ? key : DEFAULT_ROLE;
}

// The full descriptor for a (possibly untrusted) role value, normalized
// first so this always returns an object, never undefined.
export function roleRegister(value) {
  return BY_VALUE.get(normalizeRole(value));
}

// Convenience for the common case of a consumer that only needs the
// display label, e.g. the RolePicker select and its helper text.
export function roleLabel(value) {
  return roleRegister(value).label;
}
