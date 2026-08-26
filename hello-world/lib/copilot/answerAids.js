// The three functions /api/copilot/answer uses to build the "aids" that sit
// beside a drafted answer (AC-K1) and to normalise a model's raw JSON before
// anything downstream trusts it, moved out of
// app/api/copilot/answer/route.js.
//
// WHY THIS IS ITS OWN MODULE: the same reason lib/copilot/answerPrompts.js
// was extracted from this exact file earlier — see that module's own
// header. The route was approaching this project's hard 1000-line limit
// again (804 lines before this move, with AC-V5's cache/employer-fetch
// wiring and AC-V4's facts plumbing both still to land on top of it), and
// this band of it is pure computation with no Supabase client, no Gemini
// client beyond what is handed to it as an argument, no request and no
// response — a straight function of its inputs, so it is a part that can
// leave without taking any of the route's behaviour with it.
//
// The move is behaviour-preserving: every existing route test
// (route.test.js, route.knowledgeBase.test.js, streaming.test.js,
// idealProjectWiring.test.js, route.latency.test.js) exercises these three
// functions only through the route's public HTTP surface, and passes
// unchanged on both sides of this extraction — that is the whole proof that
// moving code, rather than rewriting it, is what happened here. Nothing
// about any of the three functions' logic changed; only their address did.

import { parseModelJson } from "@/lib/llm/extractEmployment";
import { buildIdealProjectPrompt, IDEAL_PROJECT_SYSTEM, normalizeIdealProject } from "@/lib/copilot/idealProjectPrompt";
import { postingBuzzwords } from "@/lib/copilot/postingBuzzwords";
import { resumeAnchor, MAX_PROJECT_WORDS } from "@/lib/copilot/resumeAnchor";
import { idealProject as idealProjectFor } from "@/lib/copilot/idealProject";
import { shortenToCue } from "@/lib/copilot/answerCues";
import { PROJECT_PAGE_SOURCE } from "@/lib/copilot/projectStories";

// The model's `points`, its `pageIds`, and (AC-V4.4) its `factIds`,
// normalised TOGETHER.
//
// THE BUG THIS PREVENTS: `points` was filtered for blanks and sliced to the
// cap while `parsed.pageIds` was passed to resolvePageSources untouched. That
// function's pairing is all-or-nothing on length — correctly so, since a
// citation against the wrong beat is worse than no citation — so one
// whitespace-only point among four cost the user EVERY citation on the answer,
// silently. The rule is right; normalising only one of the two arrays was the
// bug. `factIds` (lib/copilot/factCitations.js's resolveFactSources) has the
// identical all-or-nothing pairing rule for the identical reason, so it goes
// through this SAME index-paired pass rather than a normalisation of its own
// bolted on afterward — a third array normalised separately is exactly how
// this bug would come back, for company facts instead of pages.
//
// Pairs each raw point with its raw ids BY INDEX first, then filters and
// slices the PAIRS, then splits them — the same shape
// lib/copilot/sampleAnswerLocal.js already uses for its own index
// bookkeeping, rather than a second one.
//
// `pageIds` comes back as `null`, not `[]`, when the model returned no array
// at all: resolvePageSources must still see "nothing supplied" and fall to
// its own all-nulls path, which is not the same thing as an empty array of
// the wrong length. `factIds` comes back as `undefined` in that same case —
// deliberately NOT `null`, and deliberately not the same convention as
// `pageIds` right above it. Every caller of this function written before
// AC-V4 existed (every existing test, every route branch that never asks for
// company facts) asserts the exact TWO-key `{ points, pageIds }` shape;
// Vitest/Jest's `toEqual` treats an `undefined`-valued property as
// equivalent to an absent one, but NOT a `null`-valued one, so `factIds:
// null` here would have silently grown a third key onto every one of those
// objects and broken them. resolveFactSources' own `Array.isArray(rawFactIds)`
// check treats `null` and `undefined` identically regardless, so nothing
// downstream can tell the difference — this is a compatibility choice about
// THIS function's callers, not a semantic claim that `factIds` means
// something different from `pageIds` when it's missing.
export function normalizeModelPoints(parsed, cap) {
  const rawPoints = Array.isArray(parsed?.points) ? parsed.points : [];
  const rawPageIds = Array.isArray(parsed?.pageIds) ? parsed.pageIds : null;
  const rawFactIds = Array.isArray(parsed?.factIds) ? parsed.factIds : null;
  const paired = rawPoints
    .map((point, index) => ({
      point,
      pageId: rawPageIds ? rawPageIds[index] : null,
      factId: rawFactIds ? rawFactIds[index] : null,
    }))
    .filter((entry) => typeof entry.point === "string" && entry.point.trim())
    .slice(0, cap);
  return {
    points: paired.map((entry) => entry.point.trim()),
    pageIds: rawPageIds ? paired.map((entry) => entry.pageId) : null,
    factIds: rawFactIds ? paired.map((entry) => entry.factId) : undefined,
  };
}

// AC-N3: asks the model for a worked example grounded in the actual posting,
// instead of always handing back one of idealProjectNarrative.js's seven
// archetypes. Rides ALONGSIDE the points/answer call rather than after it —
// both call sites in route.js start this before awaiting the main response,
// so the added latency is the slower of the two requests, not their sum,
// which matters because this fires while the candidate is mid-question.
//
// Resolves to null, never rejects, on every failure mode: no posting to
// build a prompt from, a network error, unparseable JSON, or a response
// normalizeIdealProject won't vouch for. This has to be true unconditionally
// — a broken worked example is an aid beside the answer, not the answer, and
// must never be able to fail the request it rides beside or surface an
// error the candidate would see mid-question.
export async function generateIdealProjectExample({ client, geminiModel, description, question }) {
  const prompt = buildIdealProjectPrompt({ description, question });
  if (!prompt) return null;
  try {
    const response = await client.models.generateContent({
      model: geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: IDEAL_PROJECT_SYSTEM, responseMimeType: "application/json" },
    });
    const parsed = parseModelJson(response.text?.trim() || "");
    return normalizeIdealProject(parsed, { description });
  } catch {
    return null;
  }
}

// AC-K1.2/AC-K1.3: the two aids that sit BESIDE a drafted answer rather than
// inside it — the posting's own vocabulary to work in, and which of the
// candidate's own roles (and which project inside it) the answer came out of.
// Computed identically for both modes and both engines, from the same two
// pure modules, so live and practice can never show different aids for the
// same question and the aids never depend on who drafted the answer.
//
// `postingDescription` reaches ONLY this function — never buildPointsPrompt
// or buildAnswerPrompt (AC-H7.27 is unchanged: the posting description still
// never grounds an answer). See lib/copilot/postingBuzzwords.js for why a
// list the candidate reads and chooses from is a different thing from
// material an answer is generated out of.
//
// The résumé is preferred over the prep notes for the role/project because
// that is what the user asked to be told about — "the job title and company
// from my resume". The prep context is the fallback only when no résumé was
// submitted for this application, since it is often résumé-shaped text
// pasted in by hand.
//
// Async now, for exactly one reason: `generatedProjectPromise`, the in-flight
// call started by the caller (only on the Gemini path — the embedded path
// never has one), is awaited here rather than started here, so it and the
// main points/answer call are genuinely concurrent instead of one waiting on
// the other.
//
// `story` (ARCH §3.6/§4e) is lib/copilot/projectStories.js's selectBestStory
// return, selected ONCE by the caller (POST, in route.js) and handed down here
// — this function used to run a SECOND, independent selectBestStory call of
// its own, scored against {question, points}, which could disagree with the
// embedded engine's own override (scored against {question} alone) about
// which page was "the" match for the same request (D7). One selection, one
// answer, on every call site.
export async function answerAids({ postingDescription, resume, profile, question, points, generatedProjectPromise, story }) {
  const anchorText = resume || profile;
  const anchor = resumeAnchor(anchorText, { question, points });
  // The FALLBACK, computed exactly as it always has been — never skipped,
  // because a missing or rejected model response must still leave the
  // candidate with an example rather than nothing.
  const deterministicProject = idealProjectFor(postingDescription, { question, points });
  const generatedProject = generatedProjectPromise ? await generatedProjectPromise : null;
  // Page-derived fallback for the résumé-anchor aid: only reachable when
  // `anchor` above is null — i.e. neither a submitted résumé nor prep notes
  // yielded anything to name a role from — so an eligible project page never
  // displaces real résumé/prep material, it only fills a gap that would
  // otherwise be `resumeAnchor: null`. Deliberately does NOT populate `title`,
  // `company`, or `description` — and NOT because the aid would mislabel them.
  // AnswerAids.js reads a SOURCE_WHERE map keyed on `source` (it knows
  // PROJECT_PAGE_SOURCE and renders "on a project page") from both roleLabel()
  // and the no-role label, so page material is attributed honestly wherever it
  // appears. Leaving these empty was once a workaround for that; it is not one
  // now. They stay empty on their own merits:
  //
  //   - `title`/`company` model a job ROLE — AnswerAids renders them as
  //     "Closest role" / "Most recent role". A project page's title is a
  //     PROJECT name and it has no employer at all, so filling them would
  //     present a project as a role: a different category error, not a fix.
  //   - `description` has no already-computed second value here; the route
  //     derives exactly one shortened line, and it goes to `project`.
  //
  // So only `project` is set, rendered under the source-neutral "Project to
  // talk about" label. If you are here because you want richer page-derived
  // aids, that is a content feature (choosing and shortening more bullets),
  // not a matter of deleting this restraint.
  //
  // Gated on `story.matched`, exactly like the deterministic answer builders.
  //
  // THE BUG THIS PREVENTS: this used to read `if (!resumeAnchorAid && story)`,
  // and the comment here claimed the unmatched case was "honestly labelled via
  // `matched`". It was not. AnswerAids.js consults `matched` only inside its
  // role-row branch, and the shape built below (`title: ""`, `company: ""`,
  // `description: []`) never takes that branch — so the honest label was
  // unreachable and the candidate read "Project to talk about: We spent time
  // each spring checking the hives" beside an answer about disagreeing with
  // their manager. It fired on both engines, in both modes, on all three
  // surfaces, whenever there was no submitted résumé and no prep-context text:
  // the ordinary live-mode cold start. An unmatched page is the first eligible
  // one on file, not the one this question is about, so there is nothing here
  // for the aid to honestly say.
  let resumeAnchorAid = anchor ? { ...anchor, source: resume ? "resume" : "prep" } : null;
  if (!resumeAnchorAid && story?.matched) {
    const projectText = story.bullets[0] || story.title;
    resumeAnchorAid = {
      title: "",
      company: "",
      matched: story.matched,
      project: shortenToCue(projectText, MAX_PROJECT_WORDS),
      description: [],
      source: PROJECT_PAGE_SOURCE,
    };
  }
  return {
    buzzwords: postingBuzzwords(postingDescription, { question, points }),
    // AC-K1.3 correction: `anchor` is mined from whichever of `resume` /
    // `profile` was actually non-empty — with no posting selected (the
    // common live-mode case), that is the free-text prep-context textarea,
    // not a résumé. `source` reports which one so the UI can word the label
    // honestly instead of always claiming "on your resume". A third value,
    // PROJECT_PAGE_SOURCE, marks the page-derived fallback above — never
    // "resume", never "prep" (lib/copilot/projectStories.js's own contract).
    resumeAnchor: resumeAnchorAid,
    // BUG: `generatedProject` is `normalizeIdealProject`'s return value — the
    // shape of `idealProjectFor()`'s `project` FIELD ({ title, sections,
    // outcomes }), never the shape of the aid itself ({ shape, summary,
    // metrics, project }). `generatedProject || deterministicProject` used
    // to substitute the field's shape for the whole aid's shape, so on the
    // accept path `shape`/`summary`/`metrics` vanished, AnswerAids.js's
    // `hasIdealRow` computed false, and the entire block — row, disclosure,
    // worked example — rendered as nothing. The feature reached the user
    // only when the model call failed or was rejected. A valid generated
    // example must ENRICH the deterministic aid, not replace it: keep
    // `deterministicProject`'s `shape`/`summary`/`metrics` and swap only its
    // `project` for the model's. If there is no deterministic aid at all (no
    // posting, or no shape term survived — idealProjectFor returns null),
    // there is nothing for a generated example to sit beside, so the result
    // stays null rather than shipping a `project`-only object — that bare
    // shape is exactly the broken state this bug produced.
    idealProject: deterministicProject
      ? (generatedProject ? { ...deterministicProject, project: generatedProject } : deterministicProject)
      : null,
  };
}
