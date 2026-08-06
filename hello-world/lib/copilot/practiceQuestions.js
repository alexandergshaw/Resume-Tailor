// Deterministic practice-question bank — the embedded copilot's question
// generator. Given a posting (or none), it produces a full, ordered session
// of interview questions with no network call, no API key, no Math.random,
// and no Date: the same posting and the same asked-list always produce the
// same next question. Template *selection* within a group still varies (via
// `pick`, seeded on the posting's own text) so the session doesn't read as
// obviously templated.
//
// Which groups feed the bank, and in what order, is driven by the selected
// interview type's `questionGroups` (see lib/copilot/interviewTypes.js, the
// single source of truth for that vocabulary). The opening and closing
// questions are format-agnostic and always bookend the bank. An omitted or
// unrecognized interview type resolves to "general", whose questionGroups
// are exactly today's three (behavioral, technical, role) in today's order
// — that keeps buildQuestionBank(posting) and nextPracticeQuestion({
// posting, asked }) byte-identical to the pre-interview-type behavior for
// every caller that doesn't opt in.

import { profileSkills } from "./answerLocal";
import { pick } from "@/lib/text/phrasing";
import { normalizeQuestion } from "./questions";
import { interviewType as resolveInterviewType } from "./interviewTypes";

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

// Open-ended architecture prompts for a system-design interview. These carry
// type "technical" like the rest of the technical bank — "system-design" is
// a bank *group* name, not a question `type`; the type vocabulary itself
// stays the three values it's always been (behavioral, technical, general).
const SYSTEM_DESIGN_TOPICS = [
  {
    key: "scale-service",
    variants: [
      "Design a service that needs to scale to millions of users. Walk me through your approach.",
      "How would you design a system that has to handle a sudden, large spike in traffic?",
      "Walk me through how you'd architect a service for high availability at scale.",
    ],
  },
  {
    key: "data-store",
    variants: [
      "How would you design the data storage for a system with heavy read traffic and occasional writes?",
      "Walk me through how you'd choose and design a database layer for a high-traffic application.",
    ],
  },
  {
    key: "failure-modes",
    variants: [
      "Design a system that needs to stay available even when one of its dependencies goes down. How would you handle that?",
      "Walk me through how you'd design for graceful degradation when a downstream service fails.",
    ],
  },
  {
    key: "tradeoffs",
    variants: [
      "Walk me through a design where you had to trade consistency for availability. How did you decide?",
      "Design a system where you have to choose between latency and accuracy. How would you approach that trade-off?",
    ],
  },
];

function systemDesignQuestions(seed) {
  return SYSTEM_DESIGN_TOPICS.map((topic) => ({
    question: pick(`${seed}|system-design|${topic.key}`, topic.variants),
    type: "technical",
  }));
}

// Business-problem prompts for a case-study interview. Most pose a
// hypothetical to reason through out loud (type "general"); one asks about
// an actual past situation, so it carries type "behavioral" like the rest of
// the bank's past-tense questions.
const CASE_STUDY_TOPICS = [
  {
    key: "market-entry",
    type: "general",
    variants: [
      "Walk me through how you'd decide whether our company should enter a new market.",
      "How would you evaluate whether launching a new product line makes sense for us?",
    ],
  },
  {
    key: "declining-metric",
    type: "general",
    variants: [
      "A key metric for one of our products just dropped ten percent month over month. How would you figure out why?",
      "Suppose engagement on a core feature suddenly falls off. Walk me through how you'd investigate it.",
    ],
  },
  {
    key: "prioritization",
    type: "general",
    variants: [
      "How would you decide which of three competing initiatives to prioritize with limited resources?",
      "Walk me through how you'd prioritize a roadmap when every stakeholder thinks their request is most urgent.",
    ],
  },
  {
    key: "past-recommendation",
    type: "behavioral",
    variants: [
      "Tell me about a time you had to make a recommendation with incomplete data. How did you approach it, and what happened?",
      "Describe a situation where you had to structure a business problem and defend a recommendation. What was the outcome?",
    ],
  },
];

function caseStudyQuestions(seed) {
  return CASE_STUDY_TOPICS.map((topic) => ({
    question: pick(`${seed}|case-study|${topic.key}`, topic.variants),
    type: topic.type,
  }));
}

// Past-situation prompts for a leadership/management interview, plus one
// open-ended question about leadership philosophy — hence the per-topic type
// rather than a fixed one, same reasoning as the case-study group above.
const LEADERSHIP_TOPICS = [
  {
    key: "delegate",
    type: "behavioral",
    variants: [
      "Tell me about a time you had to delegate a critical piece of work. How did you decide who to trust with it, and how did it go?",
      "Describe a situation where you delegated a high-stakes task to someone on your team.",
    ],
  },
  {
    key: "underperformer",
    type: "behavioral",
    variants: [
      "Tell me about a time you had to manage someone who was underperforming. What did you do?",
      "Describe how you handled a situation where a direct report wasn't meeting expectations.",
    ],
  },
  {
    key: "difficult-decision",
    type: "behavioral",
    variants: [
      "Walk me through a difficult decision you made as a leader that wasn't popular with your team.",
      "Tell me about a time you had to make an unpopular call as the person in charge.",
    ],
  },
  {
    key: "philosophy",
    type: "general",
    variants: [
      "How would you describe your leadership or management style?",
      "What's your approach to managing and developing the people on your team?",
    ],
  },
];

function leadershipQuestions(seed) {
  return LEADERSHIP_TOPICS.map((topic) => ({
    question: pick(`${seed}|leadership|${topic.key}`, topic.variants),
    type: topic.type,
  }));
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

// group name -> builder, one entry per value in the questionGroups
// vocabulary declared by lib/copilot/interviewTypes.js. Every builder takes
// (posting, seed) so they can be called uniformly regardless of whether a
// given group actually uses the posting.
const GROUP_BUILDERS = {
  behavioral: (posting, seed) => behavioralQuestions(seed),
  technical: (posting, seed) => technicalQuestions(posting, seed),
  role: (posting, seed) => roleQuestions(posting, seed),
  "system-design": (posting, seed) => systemDesignQuestions(seed),
  "case-study": (posting, seed) => caseStudyQuestions(seed),
  leadership: (posting, seed) => leadershipQuestions(seed),
};

// Round-robins across the given groups (in order) so the result interleaves
// types instead of grouping them — each input group is internally ordered,
// and this only changes how they merge.
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
// phrasing when the posting has nothing usable for it. `interviewType` is
// resolved through interviewTypes.js (unknown/missing -> "general"), and its
// descriptor's questionGroups pick which groups feed the bank and in what
// order; the opening and closing questions always bookend it regardless of
// interview type.
export function buildQuestionBank(posting, interviewType) {
  const seed = seedFor(posting);
  const opening = openingQuestion(posting, seed);
  const closing = closingQuestion(seed);
  const { questionGroups } = resolveInterviewType(interviewType);
  const groups = questionGroups.map((name) => GROUP_BUILDERS[name](posting, seed));

  return [opening, ...interleave(groups), closing];
}

// Returns the first bank entry not yet in `asked` (compared via
// normalizeQuestion, so rewordings from the caller don't matter — only exact
// text does here since the bank itself is fixed). Never throws on a
// null/undefined posting, asked list, or interview type.
export function nextPracticeQuestion({ posting, asked, interviewType } = {}) {
  const bank = buildQuestionBank(posting, interviewType);
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
