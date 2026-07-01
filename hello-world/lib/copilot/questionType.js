// Zero-cost classifier for an interview question's type — behavioral, technical,
// or general. Used by the embedded copilot (detection + answer drafting) so it
// can label questions and pick STAR formatting the same way the LLM path does.

// Behavioral prompts ask for a past experience / story ("tell me about a time…").
const BEHAVIORAL_RE =
  /\b(tell me about a time|describe a (?:time|situation)|give me an example|walk me through a time|a time when|when have you|how did you (?:handle|deal|approach|resolve|manage)|conflict|disagree(?:d|ment)?|challeng(?:e|ing)|difficult (?:situation|person|coworker|customer|decision)|failure|failed|mistake|proud(?:est)?|accomplishment|feedback|prioriti[sz]|deadline|under pressure|stakeholder|leadership|led a|mentor)\b/i;

// Technical prompts probe engineering/domain skills.
const TECHNICAL_RE =
  /\b(algorithm|complexity|big[- ]?o|data ?structure|design (?:a|the|an) (?:system|schema|api)|system design|architect(?:ure)?|scal(?:e|ability|ing)|database|sql|query|api|framework|library|debug|optimi[sz]e|performance|latency|throughput|concurren\w+|threading|memory|cache|deploy(?:ment)?|ci\/cd|kubernetes|docker|microservice|rest|graphql|http|encryption|security|test(?:ing|s)?|unit test|code|coding|implement|function|class|object|inheritance|recursion|stack|queue|tree|graph|hash|pointer|compile|runtime|regex|schema|index(?:ing)?)\b/i;

// Returns "behavioral" | "technical" | "general". Behavioral cues win over
// technical ones because "tell me about a time you designed a system" is a story
// prompt first (STAR), and the story framing matters more than the domain.
export function classifyQuestionType(text) {
  const s = String(text || "");
  if (BEHAVIORAL_RE.test(s)) return "behavioral";
  if (TECHNICAL_RE.test(s)) return "technical";
  return "general";
}
