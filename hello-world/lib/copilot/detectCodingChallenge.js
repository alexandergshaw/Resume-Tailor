// N161 — is this interview question a request to PRODUCE code or pseudocode?
// Pure, zero imports, client/server shared (lib/copilot/ is both), never throws.
//
// WHY THIS IS NOT classifyQuestionType(q) === "technical". questionType.js's
// TECHNICAL_RE fires on any engineering vocabulary — "what is a hash map",
// "how do you approach code review" both classify technical — and every one of
// those is a CONCEPTUAL question that wants a spoken answer. A coding challenge
// is different in kind: it is an instruction to produce a concrete solution. So
// this predicate is a PRODUCTION signal, and an algorithm / data-structure /
// artifact token counts ONLY when it is paired with a production verb (or sits
// inside a self-contained problem statement), never on its own. That
// AND-combination is the load-bearing invariant: widening any token list below
// is fine, but a token that matches without its verb turns "what is a hash map"
// into a coding challenge and defeats the whole gate. Do not route this through
// classifyQuestionType, and do not widen either VALID_TYPES list for it.
//
// A false positive REPLACES a spoken answer with a code block; a false negative
// leaves today's behaviour untouched. So the lists are deliberately narrow, and
// real-world recall on live machine-transcribed speech is a known, accepted
// limit (the fixed corpus in detectCodingChallenge.test.js is the oracle).

// Past-experience framing ("tell me about a time you wrote a script...") is a
// behavioral question that merely mentions code — never a request to write it.
const PAST_EXPERIENCE_RE = /\b(tell me about a time|describe a (?:time|situation)|a time when|have you ever)\b/i;

// production verb + a generic artifact: "write a function", "implement a
// method", "design an algorithm", "code a script", "write a SQL query".
const VERB_ARTIFACT_RE =
  /\b(write|code|implement|design)\b[^?]{0,20}\b(function|method|program|algorithm|routine|script|query|class|regex)\b/i;

// production verb + a named algorithm / data structure: "implement binary
// search", "write a linked list". `give` is excluded on purpose — "can you give
// an overview of a stack" is conceptual.
const VERB_NAMED_RE =
  /\b(write|code|implement)\b[^?]{0,30}\b(binary search|linked list|hash (?:map|table)|bfs|dfs|breadth-first|depth-first|quicksort|merge ?sort|fibonacci|palindrome|anagram|two ?sum|stack|queue|tree|trie|graph)\b/i;

// An explicit ask for pseudocode: "give pseudocode for ...", "write pseudocode".
const PSEUDOCODE_RE =
  /\b(?:write|give|show|provide|sketch|draft)\b[^?]{0,20}\bpseudo[\s-]?code\b|\bpseudo[\s-]?code\s+(?:for|to|of|that|which)\b/i;

// A self-contained problem statement: "given an array of integers, return ..."
// needs a data noun between "given" and the action, so "given your background,
// how would you find ..." stays a behavioral/role-fit question.
const PROBLEM_STATEMENT_RE =
  /\bgiven\b[^?]{0,40}\b(?:array|list|string|integer|number|tree|graph|matrix|sequence|node|input|table|word|character)s?\b[^?]{0,80}\b(?:return|print|output|find|compute|determine|produce|count)\b/i;

// Canonical named challenges that need no verb.
const NAMED_CHALLENGE_RE = /\bfizz\s?buzz\b/i;

const CODING_RES = [VERB_ARTIFACT_RE, VERB_NAMED_RE, PSEUDOCODE_RE, PROBLEM_STATEMENT_RE, NAMED_CHALLENGE_RE];

export function detectCodingChallenge(question) {
  const text = String(question ?? "");
  if (!text || PAST_EXPERIENCE_RE.test(text)) return false;
  return CODING_RES.some((re) => re.test(text));
}
