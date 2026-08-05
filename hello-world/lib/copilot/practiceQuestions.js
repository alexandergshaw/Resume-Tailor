// Deterministic practice-question bank — the embedded copilot's question
// generator. Given a posting (or none), it produces a full, ordered session
// of interview questions with no network call, no API key, no Math.random,
// and no Date: the same posting and the same asked-list always produce the
// same next question. Template *selection* within a group still varies (via
// `pick`, seeded on the posting's own text) so the session doesn't read as
// obviously templated.

import { profileSkills } from "./answerLocal";
import { pick } from "@/lib/text/phrasing";
import { normalizeQuestion } from "./questions";

const MAX_TECHNICAL_TERMS = 5;

function seedFor(posting) {
  const parts = [posting?.title, posting?.company, posting?.description].filter(Boolean);
  return parts.join("|") || "generic-posting";
}

function openingQuestion(posting, seed) {
  const title = String(posting?.title || "").trim();
  const company = String(posting?.company || "").trim();
  let question;
  if (title && company) {
    question = pick(`${seed}|opening`, [
      `To start, tell me about yourself and what draws you to the ${title} role at ${company}.`,
      `Walk me through your background and why you're interested in the ${title} position at ${company}.`,
      `Tell me about yourself, and what makes the ${title} role at ${company} a fit for you.`,
    ]);
  } else if (title) {
    question = pick(`${seed}|opening`, [
      `To start, tell me about yourself and what draws you to a ${title} role.`,
      `Walk me through your background and why you're interested in ${title} positions.`,
    ]);
  } else if (company) {
    question = pick(`${seed}|opening`, [
      `To start, tell me about yourself and what draws you to ${company}.`,
      `Walk me through your background and why you're interested in working at ${company}.`,
    ]);
  } else {
    question = pick(`${seed}|opening`, [
      "To start, tell me about yourself.",
      "Walk me through your background.",
      "Tell me a bit about yourself and your career so far.",
    ]);
  }
  return { question, type: "general" };
}

// STAR-friendly behavioral prompts. Each topic offers a few equivalent
// phrasings so the session doesn't read as a fixed script; `pick` chooses
// one per topic, seeded on the posting so it's stable for a given posting.
const BEHAVIORAL_TOPICS = [
  {
    key: "conflict",
    variants: [
      "Tell me about a time you disagreed with a coworker or manager. How did you handle it?",
      "Describe a situation where you had a conflict with someone on your team — what happened, and how did you resolve it?",
      "Walk me through a time you had to work through a disagreement with a colleague.",
    ],
  },
  {
    key: "failure",
    variants: [
      "Tell me about a time you failed at something. What did you learn?",
      "Describe a project or task that didn't go the way you planned — what happened, and what did you take away from it?",
      "Walk me through a mistake you made at work and how you recovered from it.",
    ],
  },
  {
    key: "deadline",
    variants: [
      "Tell me about a time you were up against a tight deadline. How did you manage it?",
      "Describe a situation where you had to deliver under significant time pressure.",
      "Walk me through how you handled a project where the deadline was at risk.",
    ],
  },
  {
    key: "ambiguous",
    variants: [
      "Tell me about a time you had to solve a problem with unclear or incomplete requirements.",
      "Describe a situation where the goal was ambiguous — how did you figure out what to do?",
      "Walk me through a time you had to make progress despite a lot of uncertainty.",
    ],
  },
  {
    key: "leadership",
    variants: [
      "Tell me about a time you led an initiative without having formal authority over the people involved.",
      "Describe a situation where you had to influence a team or project you weren't officially in charge of.",
      "Walk me through a time you rallied others around an idea when you weren't the manager.",
    ],
  },
  {
    key: "feedback",
    variants: [
      "Tell me about a time you received tough feedback. How did you respond?",
      "Describe a piece of critical feedback that changed how you work.",
      "Walk me through how you've handled feedback that was hard to hear.",
    ],
  },
];

function behavioralQuestions(seed) {
  return BEHAVIORAL_TOPICS.map((topic) => ({
    question: pick(`${seed}|behavioral|${topic.key}`, topic.variants),
    type: "behavioral",
  }));
}

// Template variants for a technical question built around one term from the
// posting's own vocabulary.
const TECHNICAL_TEMPLATES = [
  (term) => `Walk me through a project where you used ${term} — what was your role, and what did you build?`,
  (term) => `Tell me about a time you used ${term} in production. What trade-offs did you have to make?`,
  (term) => `How would you explain ${term} to someone less familiar with it, and when would you reach for it over the alternatives?`,
  (term) => `What's a hard problem you've solved using ${term}, and how did you approach it?`,
];

// Generic fallback so a posting with no usable description (or no posting at
// all) still yields a full technical portion of the session.
const GENERIC_TECHNICAL = [
  "Walk me through a technical project you're proud of, from start to finish.",
  "Tell me about a time you had to debug a hard problem in production. How did you track it down?",
  "How do you approach learning a new technology or tool quickly?",
  "Tell me about a technical decision you made that involved a real trade-off. How did you decide?",
  "How do you make sure the code you ship is reliable and maintainable?",
];

function technicalQuestions(posting, seed) {
  // Same extraction as profileSkills in answerLocal.js: extractKeywords over
  // defaultLibraryData.taxonomy, highest-scoring canonical terms first.
  const terms = profileSkills(posting?.description, MAX_TECHNICAL_TERMS);
  if (terms.length === 0) {
    return GENERIC_TECHNICAL.map((question) => ({ question, type: "technical" }));
  }
  return terms.map((term) => ({
    question: pick(`${seed}|technical|${term}`, TECHNICAL_TEMPLATES)(term),
    type: "technical",
  }));
}

function roleQuestions(posting, seed) {
  const title = String(posting?.title || "").trim();
  const company = String(posting?.company || "").trim();

  let whyRole;
  if (title && company) {
    whyRole = pick(`${seed}|why-role`, [
      `Why are you interested in the ${title} role at ${company}?`,
      `What draws you to this ${title} position at ${company} specifically?`,
      `Why do you want to work as a ${title} at ${company}?`,
    ]);
  } else if (title) {
    whyRole = pick(`${seed}|why-role`, [
      `Why are you interested in a ${title} role?`,
      `What draws you to ${title} positions?`,
    ]);
  } else if (company) {
    whyRole = pick(`${seed}|why-role`, [
      `Why are you interested in working at ${company}?`,
      `What draws you to ${company} specifically?`,
    ]);
  } else {
    whyRole = pick(`${seed}|why-role`, [
      "Why are you interested in this type of role?",
      "What are you looking for in your next role?",
    ]);
  }

  const whatYouKnow = company
    ? pick(`${seed}|know-company`, [
        `What do you know about ${company} and what we do?`,
        `What have you learned about ${company} so far?`,
      ])
    : pick(`${seed}|know-company`, [
        "What do you know about this company and what it does?",
        "What have you learned about this opportunity so far?",
      ]);

  return [
    { question: whyRole, type: "general" },
    { question: whatYouKnow, type: "general" },
  ];
}

function closingQuestion(seed) {
  return {
    question: pick(`${seed}|closing`, [
      "What questions do you have for us?",
      "What questions do you have for me about the role or the team?",
      "Before we wrap up, what questions do you have for us?",
    ]),
    type: "general",
  };
}

// Round-robins across the given groups (in order) so the result interleaves
// types instead of grouping them — the input groups (behavioral, technical,
// role) are each internally ordered, and this only changes how they merge.
function interleave(groups) {
  const out = [];
  const queues = groups.map((g) => [...g]);
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      if (q.length) {
        out.push(q.shift());
        added = true;
      }
    }
  }
  return out;
}

// Builds the full, ordered question bank for a posting. Never empty, even
// when `posting` is null/undefined — every section degrades to a generic
// phrasing when the posting has nothing usable for it.
export function buildQuestionBank(posting) {
  const seed = seedFor(posting);
  const opening = openingQuestion(posting, seed);
  const behavioral = behavioralQuestions(seed);
  const technical = technicalQuestions(posting, seed);
  const role = roleQuestions(posting, seed);
  const closing = closingQuestion(seed);

  return [opening, ...interleave([behavioral, technical, role]), closing];
}

// Returns the first bank entry not yet in `asked` (compared via
// normalizeQuestion, so rewordings from the caller don't matter — only exact
// text does here since the bank itself is fixed). Never throws on a
// null/undefined posting or asked list.
export function nextPracticeQuestion({ posting, asked } = {}) {
  const bank = buildQuestionBank(posting);
  const askedList = Array.isArray(asked) ? asked : [];
  const askedNorms = new Set(
    askedList
      .map((q) => normalizeQuestion(typeof q === "string" ? q : ""))
      .filter(Boolean),
  );

  for (const entry of bank) {
    if (!askedNorms.has(normalizeQuestion(entry.question))) {
      return entry;
    }
  }
  return { question: "", type: "general", exhausted: true };
}
