// Which of the candidate's OWN roles this question lands on, and the one
// concrete project from it worth telling the story about.
//
// A sample answer already quotes the candidate's material, but it never says
// where the material came from — so a candidate reading it mid-interview
// still has to remember which job they were describing before they can
// expand on it. This names the job (title + company) and the project inside
// it, as two short labels sitting beside the answer.
//
// Grounding is structural, exactly as in sampleAnswerLocal.js: every value
// returned here is text that literally occurs in the material passed in.
// parseEmploymentHistory reads the employment section of the candidate's own
// submitted résumé, and the project is one of that role's own bullets —
// nothing is inferred about an employer, a project, or a date that the
// document does not state. `matched` reports honestly whether the role was
// picked because it OVERLAPS the question or merely because it was the most
// recent one on file, so the caller can label it truthfully instead of
// claiming a relevance that was never computed.
//
// Pure and network-free — both engines call it, so the named role never
// depends on which engine drafted the answer.

import { parseEmploymentHistory } from "@/lib/resume/parseEmployment";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { pastWorkExperienceLine, rankedExperienceLines, MOTIVATION_LINE_RE } from "./answerLocal.js";
import { shortenToCue } from "./answerCues.js";

// A project label may run longer than an answer cue: it has to be specific
// enough to identify WHICH piece of work is meant, which "Built the thing"
// is not.
export const MAX_PROJECT_WORDS = 10;

// `description` is a REMINDER of the role's scope, not the one thing worth
// telling a story about — but each phrase is still shortened the same way
// `project` is (MAX_PROJECT_WORDS, not the tighter default cue budget),
// because a phrase truncated too aggressively reads as if its dropped tail
// were never there (BUG-K2: "...serving" silently losing "2M requests per
// day"). Capped at two phrases so it never grows into a second bullet list
// under the role line.
export const MAX_DESCRIPTION_LINES = 2;
// Ranked candidates pulled before filtering out the project's own line and
// any motivation line — wider than MAX_DESCRIPTION_LINES so both filters
// still have enough left to choose from.
const MAX_DESCRIPTION_CANDIDATES = 5;

// Enough history that a question about early-career work can still find its
// role, without scanning a résumé's worth of unparsed tail.
const MAX_ROLES = 8;

// The same stopword list tailor-lite's keyword extractor uses, so "which
// terms are meaningful" is answered one way across the app rather than two.
const STOPWORDS = new Set(defaultLibraryData.stopwords);

function significantTerms(text) {
  const found = String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  // A bare number (e.g. "200") is not a meaningful overlap signal — it lets
  // an unrelated role score `matched: true` purely because both the
  // question and the role happen to mention the same digit run.
  return new Set(found.filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t)));
}

function overlapScore(terms, text) {
  let score = 0;
  for (const term of significantTerms(text)) {
    if (terms.has(term)) score += 1;
  }
  return score;
}

// The résumé role that best fits what is being answered, plus a project from
// it. `question` and `points` together are what the role is matched against —
// the question alone is often too short to discriminate ("Tell me about a
// time you led a team"), and the drafted answer already selected the material
// that mattered, so scoring against both finds the role that answer came out
// of rather than a role that merely shares a word with the question.
//
// Returns null when the material yields neither a role nor a project. Ties
// resolve to the FIRST parsed entry, which parseEmploymentHistory orders as
// the résumé does — most recent first on a conventional résumé — so a
// question that matches nothing lands on current work rather than something
// arbitrary.
export function resumeAnchor(resumeText, { question = "", points = [] } = {}) {
  const text = String(resumeText || "").trim();
  if (!text) return null;

  const context = [String(question || ""), ...(Array.isArray(points) ? points : []).map((p) => String(p || ""))]
    .join(" ")
    .trim();
  const terms = significantTerms(context);

  const positions = parseEmploymentHistory(text, { maxEntries: MAX_ROLES });
  let best = null;
  let bestScore = -1;
  for (const position of positions) {
    if (!position.title && !position.company) continue;
    const score = overlapScore(terms, `${position.title} ${position.company} ${position.notes}`);
    if (score > bestScore) {
      bestScore = score;
      best = position;
    }
  }

  // The project always comes from the role just named — a project
  // attributed to one employer while the label beside it names another is
  // worse than no project at all. The whole-résumé search below is only
  // reachable when NO role was named (`best` is null): with a named role
  // whose own bullets don't survive pastWorkExperienceLine, the honest
  // result is no project, not a project borrowed from a different employer.
  // pastWorkExperienceLine is reused rather than re-derived so the same
  // disqualification applies here as in the drafted answer: a cover letter's
  // "I am applying for..." opener can out-score a real accomplishment on
  // keyword overlap and must never be presented as a project.
  const projectLine = best ? pastWorkExperienceLine(best.notes, context) : pastWorkExperienceLine(text, context);
  const project = shortenToCue(projectLine, MAX_PROJECT_WORDS);

  // `description`: up to two more short phrases from the SAME role's own
  // bullets, so the candidate is reminded of the role's scope, not just its
  // title — only meaningful once a role was actually named (`best`), since
  // "the same role" has no referent in the whole-résumé fallback below.
  // rankedExperienceLines is the same scoring pastWorkExperienceLine's own
  // relevantExperienceLine call uses, so "the project" and "the rest of the
  // role's bullets" can never disagree about what counts as a usable line.
  // `projectLine` (the RAW line, before shortenToCue) is excluded by exact
  // match — both it and every candidate here went through the identical
  // cleanLine transform, so the same source bullet always compares equal to
  // itself. MOTIVATION_LINE_RE is applied again here for the same reason
  // pastWorkExperienceLine applies it to the project: a cover letter's
  // "I am applying for..." opener must never be presented as a description
  // any more than as a project, even when it out-scores a real bullet on
  // overlap alone.
  //
  // BUG-K2: this is an ARRAY, one entry per bullet — NEVER a joined string.
  // An earlier version joined the shortened phrases with a space, which
  // spliced two INDEPENDENT bullets into a single run-on sentence with no
  // separator (and no indication where one bullet's material ended and the
  // other's began) — read aloud in an interview, that reads as one claim
  // nobody wrote. Each element here is one bullet's own shortenToCue result,
  // complete and self-contained; AnswerAids.js renders them as separate
  // lines rather than concatenating them back into one string.
  let description = [];
  if (best) {
    const candidates = rankedExperienceLines(best.notes, context, MAX_DESCRIPTION_CANDIDATES).filter(
      (line) => line !== projectLine && !MOTIVATION_LINE_RE.test(line),
    );
    description = candidates
      .slice(0, MAX_DESCRIPTION_LINES)
      .map((line) => shortenToCue(line, MAX_PROJECT_WORDS))
      .filter(Boolean);
  }

  if (!best) return project ? { title: "", company: "", matched: false, project, description: [] } : null;
  return {
    title: best.title || "",
    company: best.company || "",
    matched: bestScore > 0,
    project,
    description,
  };
}
