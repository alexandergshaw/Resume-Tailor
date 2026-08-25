import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { parseModelJson } from "@/lib/llm/extractEmployment";
import { listPages } from "@/lib/supabase/experiencePages";
import { listAttachmentsByPage } from "@/lib/supabase/experienceAttachments";
import { withDerivedKind } from "@/lib/experience/attachments";
import { buildMeetingContext } from "@/lib/meeting/meetingContext";
import { localInsights } from "@/lib/meeting/insightsLocal";
import { normalizeTopic, normalizeInsights } from "@/lib/meeting/insightContract";

// One read of the meeting copilot's insights panel. Fires on a pause in the
// conversation (lib/meeting/chunkTrigger.js decides when), never streams
// (AC: its payload is short and this isn't a glanceable-as-it-arrives UI the
// way the interview copilot's answer stream is), and — the part that matters
// most for what this route is allowed to accept — takes NO page bodies and
// NO user id on the wire. The client sends only what it could not have
// fetched itself (transcript / topic / which insights are already on
// screen); every piece of the user's own knowledge base is fetched HERE,
// server-side, scoped to the authenticated session, for the exact same
// reason app/api/copilot/answer/route.js's own comment gives for
// applicationId/resume/coverLetter: a client-supplied page body would let
// anyone hand this route arbitrary text and have it come back dressed as
// "your own notes say...".

const MAX_TRANSCRIPT_CHARS = 8000;
const MAX_TOPIC_CHARS = 300;
const MAX_PAGE_ID_CHARS = 100;
const MAX_KNOWN_IDS = 200;

const SYSTEM = [
  "You are a silent live-meeting copilot, listening to an ongoing conversation.",
  'Given the transcript so far and the user\'s own knowledge-base pages (if any), surface a SMALL number of genuinely useful insights — never a running summary and never small talk.',
  'An insight is exactly one of three kinds: "point" — a discussion point worth raising, but ONLY when it is directly grounded in the pages provided, never invented; "question" — a question raised in the conversation that nobody has actually answered yet; "gap" — something the user\'s own material already covers that has not come up in the room yet, or is worth pulling up right now.',
  'When an insight is grounded in one of the user\'s own pages, cite it with source: { "kind": "page", "pageId": "<exact id from the pages you were shown>", "pageTitle": "<that page\'s title>" } — the id must be copied exactly as given; never invent one and never cite a page you were not shown. When it comes from the room\'s own conversation, use source: { "kind": "transcript" }. Never invent a third shape.',
  "Return 0-5 insights. Fewer, sharper insights beat a longer list — this is read mid-conversation, in a glance.",
  "Also return the current topic of conversation as a few words (not a sentence) and your own confidence in that read as \"low\", \"medium\", or \"high\".",
].join(" ");

function buildPrompt({ contextContent, transcript, topic }) {
  const parts = [
    "--- YOUR OWN KNOWLEDGE BASE (pages you have written; may ground a point or a gap) ---",
    contextContent,
    "",
    "--- TRANSCRIPT SO FAR (most recent last) ---",
    transcript || "(nothing said yet)",
  ];
  if (topic) {
    parts.push("", `Previously identified topic (for continuity only, not authority): ${topic}`);
  }
  parts.push(
    "",
    'Return ONLY JSON of this exact shape: { "topic": string, "confidence": "low" | "medium" | "high", "insights": [{ "text": string, "kind": "point" | "question" | "gap", "source": { "kind": "page" | "transcript", "pageId"?: string, "pageTitle"?: string } }] }',
  );
  return parts.join("\n");
}

function droppedPageNotice(droppedPageCount) {
  if (droppedPageCount <= 0) return "";
  return `${droppedPageCount} page${droppedPageCount === 1 ? "" : "s"} not included to fit the meeting context budget.`;
}

// The transcript the client sends is a WINDOW of recent turns, and the
// prompt above promises "TRANSCRIPT SO FAR (most recent last)" — so when
// that window is over budget, the half worth keeping is the END.
//
// THE BUG THIS REPLACES: `.slice(0, MAX_TRANSCRIPT_CHARS)` kept characters
// 0-8000, i.e. the opening of the meeting, forever. Past roughly 100 turns
// every read saw only the first few minutes; the topic and the insights
// froze on the opening small talk and never moved again, while reads kept
// firing every ~20 seconds and spending a model call each time.
//
// The cut is then advanced FORWARD to the next line break so the window
// never opens mid-sentence: a half-turn reads as a claim that starts
// nowhere, and lib/meeting/insightsLocal.js splits on newlines to find
// turns at all, so a severed first line would be scored as a whole
// utterance. Falls back to the raw tail when the tail holds no break (one
// enormous unbroken turn — better a mid-sentence start than an empty
// transcript).
function recentTranscript(raw) {
  if (raw.length <= MAX_TRANSCRIPT_CHARS) return raw;
  const tail = raw.slice(-MAX_TRANSCRIPT_CHARS);
  const firstBreak = tail.indexOf("\n");
  if (firstBreak === -1) return tail;
  const trimmed = tail.slice(firstBreak + 1);
  return trimmed || tail;
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user } = {},
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return Response.json({ error: "Sign in to use the meeting copilot." }, { status: 401 });
    }

    const body = await request.json();
    const transcript = recentTranscript((body?.transcript ?? "").toString());
    const topic = (body?.topic ?? "").toString().slice(0, MAX_TOPIC_CHARS);
    const knownInsightIds = (Array.isArray(body?.knownInsightIds) ? body.knownInsightIds : [])
      .filter((id) => typeof id === "string")
      .slice(0, MAX_KNOWN_IDS);
    const pinnedPageId = typeof body?.pageId === "string" ? body.pageId.slice(0, MAX_PAGE_ID_CHARS) : null;

    // The route's own knowledge-base fetch — see this file's header comment.
    // Neither call throws (each degrades to an empty/error result on any
    // failure — their modules' own contract), so a broken or empty table
    // never breaks a request that otherwise has everything it needs to
    // answer from the transcript alone.
    //
    // The user asked for their saved pages AND FILES as context, so the
    // attachment inventory is fetched here and grafted onto its pages before
    // buildMeetingContext runs: that module's whole attachment apparatus —
    // the inventory lines and the "no attachment file contents were read"
    // notice guarding them — reads `page.attachments`, which nothing had
    // ever populated, because attachments live in their own table and
    // listPages returns experience_pages rows. ONE query for the lot
    // (listAttachmentsByPage), never one per page: this runs every ~20
    // seconds for the length of a meeting.
    const [{ pages: pagesResult }, { byPageId: attachmentsByPageId }] = await Promise.all([
      listPages(supabase, user.id),
      listAttachmentsByPage(supabase, user.id),
    ]);
    const pages = (Array.isArray(pagesResult) ? pagesResult : []).map((page) => {
      const rows = attachmentsByPageId.get(page?.id) || [];
      if (rows.length === 0) return page;
      return { ...page, attachments: rows.map(withDerivedKind) };
    });

    const meetingContext = buildMeetingContext({ pages, topic, transcript, pinnedPageId });
    const contextMeta = {
      includedPageCount: meetingContext.includedPageIds.length,
      droppedPageCount: meetingContext.droppedPageCount,
      truncated: meetingContext.truncated,
      notice: droppedPageNotice(meetingContext.droppedPageCount),
    };

    // THE WIRE SHAPE, in one place so both engines cannot drift apart:
    //   { topic, topicChanged, topicConfidence, insights, context,
    //     degraded?, degradedReason? }
    //
    // `topic` goes out as a plain STRING — the client holds it as one and
    // echoes it straight back as this route's `topic` request field, which
    // is what makes normalizeTopic's continuity comparison work at all.
    // Flattening here rather than shipping normalizeTopic's whole
    // `{ text, changed, confidence }` object is also what keeps `changed`
    // alive as `topicChanged`: that flag is computed SERVER-side on purpose
    // (a model asked "did the topic change?" says yes far too often — see
    // insightContract.js's normalizeTopic), and it drives whether the UI
    // interrupts the user mid-meeting, so dropping it would be losing the
    // one part of the topic read that took real care to get right.
    function insightsResponse(topicResult, insights, extra = {}) {
      return Response.json({
        topic: topicResult.text,
        topicChanged: topicResult.changed,
        topicConfidence: topicResult.confidence,
        insights,
        context: contextMeta,
        ...extra,
      });
    }

    // Shared by both the embedded branch below and the Gemini-failure
    // fallback: the local path always works (it never touches the network),
    // so it is what stands in whenever there is no model result to show —
    // an empty panel mid-meeting is worse than a weaker one. Mirrors
    // app/api/copilot/detect/route.js's own degrade-to-local precedent.
    //
    // `local.insights` is passed through UNCHANGED. It is tempting to re-run
    // normalizeInsights here against meetingContext.includedPageIds "for
    // symmetry with the Gemini branch below", and that is precisely the bug
    // this comment exists to stop someone re-introducing.
    //
    // `includedPageIds` is a PROMPT BUDGET: it names the pages that fitted
    // into the context we send a model. The local path sends no prompt. It
    // reads the user's pages directly and quotes a bullet verbatim out of
    // one, so its citation is true by construction — it is the one path in
    // this repo that structurally cannot hallucinate a source. Re-checking it
    // against a budget that was never applied would downgrade a real citation
    // to `{ kind: "model" }` whenever the cited page happened not to fit,
    // i.e. tell the user the model made up a line they wrote themselves.
    //
    // The downgrade rule catches a MODEL citing a page it was never shown, so
    // it belongs to the model path only. The local path enforces the same
    // rule against its own honest set (the pages it actually drew from) once,
    // inside lib/meeting/insightsLocal.js — see that file's comment on
    // localInsights. One enforcement point per path, no double pass.
    //
    // `pinnedPageId` is passed through for the same reason the model path
    // gets it: the page open when the meeting started is the one relevance
    // signal in this whole feature that is not a guess. Withholding it here
    // made the embedded engine — and every degraded fallback, which lands
    // here too — rank the user's own chosen page purely on word overlap.
    function respondWithLocal(extra = {}) {
      const local = localInsights({ pages, transcript, topic, knownInsightIds, pinnedPageId });
      return insightsResponse(local.topic, local.insights, extra);
    }

    if (wantsEmbedded(body?.engine)) {
      return respondWithLocal();
    }

    try {
      const { geminiModel } = getServerEnv();
      const client = getGeminiClient();
      const response = await client.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt({ contextContent: meetingContext.content, transcript, topic }) }],
          },
        ],
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json" },
      });

      const parsed = parseModelJson(response.text?.trim() || "") || {};
      const rawTopicText = typeof parsed.topic === "string" ? parsed.topic : "";
      const rawConfidence = typeof parsed.confidence === "string" ? parsed.confidence : "";
      const normalizedTopic = normalizeTopic(rawTopicText, topic, rawConfidence);

      const rawInsights = Array.isArray(parsed.insights) ? parsed.insights : [];
      const insights = normalizeInsights(rawInsights, {
        includedPageIds: meetingContext.includedPageIds,
        knownInsightIds,
      });

      return insightsResponse(normalizedTopic, insights);
    } catch (llmErr) {
      // AC (mirrors /api/copilot/detect's own degrade rule): no API key
      // configured, a broken client, or the model call itself failing are
      // all about the INFRASTRUCTURE, not this particular read — none of it
      // should surface as a 502 that blanks the panel mid-meeting.
      return respondWithLocal({
        degraded: true,
        degradedReason: llmErr?.message || "Meeting insight generation unavailable.",
      });
    }
  } catch (err) {
    return Response.json({ error: err?.message || "Meeting insight request failed." }, { status: 500 });
  }
}
