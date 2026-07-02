// Extractive question-answering over the pinned posting — the embedded chat's
// version of "ask the document a question". Deterministic and quote-honest:
// answers are the posting's OWN sentences (selected by topic evidence + term
// overlap), never a paraphrase, and a question the posting doesn't answer gets
// an explicit not-found instead of a guess.

import { rankSentences } from "@/lib/text/summarize";

const MAX_SENTENCE_CHARS = 240;

// Question topics with (a) how the user asks and (b) what counts as evidence in
// the posting. A sentence must carry evidence to be quoted as the answer — a
// "salary" answer without a number is no answer.
const TOPICS = [
  {
    id: "salary",
    label: "compensation or a pay range",
    ask: /\b(salary|pay|paid|compensation|how much|wage|hourly rate|stipend)\b/i,
    // Negotiation coaching is a different intent — don't hijack it.
    notAsk: /\b(?:negotiat\w*|counter\w*|sign[- ]?on|ask for more|raise)\b/i,
    evidence: /\$\s?\d|\d{1,3},\d{3}|\d{2,3}\s?[kK]\b|\bper (?:hour|year|annum)\b|\bhourly\b|\bannually\b|salary|compensation/i,
  },
  {
    id: "remote",
    label: "remote or on-site work arrangements",
    ask: /\b(remote|hybrid|on-?site|in[- ]office|work from home|wfh|where is (it|the job|this role)|location)\b/i,
    evidence: /\b(remote|hybrid|on-?site|in[- ]office|work from home|wfh|relocat\w+|based in|located)\b/i,
  },
  {
    id: "degree",
    label: "a degree or education requirement",
    ask: /\b(degree|education|bachelor'?s?|master'?s?|ph\.?d)\b/i,
    evidence: /\b(degree|bachelor|master|ph\.?d|diploma|GED|education)\b/i,
  },
  {
    id: "experience",
    label: "a years-of-experience requirement",
    ask: /\b(how (?:many|much) (?:years|experience)|years of experience|experience (?:required|needed|do (?:i|you) need)|seniority)\b/i,
    evidence: /\b\d+\+?\s*(?:years?|yrs?)\b/i,
  },
  {
    id: "benefits",
    label: "benefits",
    ask: /\b(benefits?|401k|401\(k\)|insurance|pto|paid time off|vacation|parental leave|perks)\b/i,
    evidence: /\b(benefits?|401k|401\(k\)|insurance|dental|vision|pto|paid time off|vacation|parental leave|retirement|perks)\b/i,
  },
  {
    id: "deadline",
    label: "an application deadline",
    ask: /\b(deadline|apply by|when (?:do|does|is)|closing date|how long is it open)\b/i,
    evidence: /\b(deadline|apply by|applications? (?:close|due)|clos(?:es|ing)|open until|priority date)\b/i,
  },
  {
    id: "visa",
    label: "visa sponsorship or work authorization",
    ask: /\b(visa|sponsor(?:ship)?|work authorization|citizen(?:ship)?)\b/i,
    evidence: /\b(visa|sponsor|work authorization|citizen|permanent resident|right to work)\b/i,
  },
  {
    id: "clearance",
    label: "a security clearance requirement",
    ask: /\b(clearance|polygraph)\b/i,
    evidence: /\b(clearance|secret|polygraph|public trust)\b/i,
  },
  {
    id: "travel",
    label: "travel requirements",
    ask: /\btravel\b/i,
    evidence: /\btravel\b/i,
  },
  {
    id: "schedule",
    label: "the employment type or schedule",
    ask: /\b(full[- ]?time|part[- ]?time|contract|temporary|shift|hours per week|schedule)\b/i,
    evidence: /\b(full[- ]?time|part[- ]?time|contract|temporary|shift|hours per week|per diem)\b/i,
  },
];

// Does the message read like a question at all?
const QUESTIONISH_RE =
  /(\?\s*$)|^(?:who|what|when|where|why|which|how|is|are|does|do|did|can|could|will|would|should)\b/i;
// ...and is it about the pinned subject rather than the user themselves?
const SUBJECT_REF_RE = /\b(it|this|that|the (?:role|job|posting|position|company|listing))\b/i;

// Words too common in questions (or generic to any posting) to count as
// evidence that a sentence actually answers the question.
const QA_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "these", "those", "what", "when", "where", "which",
  "who", "why", "how", "does", "will", "would", "could", "should", "can", "are", "is", "was",
  "you", "your", "they", "them", "their", "about", "there", "here", "from", "into", "have", "has",
  "role", "job", "position", "posting", "company", "listing", "work", "need", "want", "tell",
]);

export function qaTopicOf(question) {
  const q = String(question || "");
  for (const t of TOPICS) {
    if (t.ask.test(q) && !(t.notAsk && t.notAsk.test(q))) return t;
  }
  return null;
}

function clamp(sentence) {
  const s = String(sentence || "").trim();
  return s.length > MAX_SENTENCE_CHARS ? `${s.slice(0, MAX_SENTENCE_CHARS).trim()}…` : s;
}

// Answer a question from the subject text. Returns:
//   { type: "answer", text }            — quoted sentence(s) from the posting
//   { type: "not-found", topic, label } — the topic was clearly asked, but the
//                                         posting has no evidence for it
//   null                                — not a subject question we can take
export function extractiveAnswer(question, subject) {
  const q = String(question || "").trim();
  const body = String(subject || "").trim();
  if (!q || !body) return null;

  const topic = qaTopicOf(q);
  const questionish = QUESTIONISH_RE.test(q);
  if (!topic && !(questionish && SUBJECT_REF_RE.test(q))) return null;

  const ranked = rankSentences(body, { query: q });
  if (topic) {
    const withEvidence = ranked.filter((r) => topic.evidence.test(r.sentence));
    if (withEvidence.length === 0) return { type: "not-found", topic: topic.id, label: topic.label };
    const picks = withEvidence.slice(0, 2).sort((a, b) => a.idx - b.idx);
    return {
      type: "answer",
      text: `From the posting: ${picks.map((p) => `"${clamp(p.sentence)}"`).join(" ")}`,
    };
  }

  // Generic subject question: pick the sentence sharing the most MEANINGFUL
  // terms with the question (stopwords and posting-generic words excluded), so
  // we never quote an arbitrary high-frequency sentence as if it answered.
  const qTerms = new Set(
    (q.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !QA_STOPWORDS.has(w)),
  );
  if (qTerms.size === 0) return null;
  let best = null;
  let bestOverlap = 0;
  for (const r of ranked) {
    const overlap = new Set(
      (r.sentence.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => qTerms.has(w)),
    ).size;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = r;
    }
  }
  if (!best || bestOverlap < 1) return null;
  return { type: "answer", text: `From the posting: "${clamp(best.sentence)}"` };
}
