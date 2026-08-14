import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { listPages, createPage, updatePage } from "@/lib/supabase/experiencePages";
import { listAttachments } from "@/lib/supabase/experienceAttachments";
import { breadcrumb } from "@/lib/experience/tree";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { buildResearchPrompt, reconcileCitations } from "@/lib/experience/researchReport";
import { extractGroundingSources } from "@/lib/llm/grounding";

export const runtime = "nodejs";

// Re-exported so lib/llm/grounding.test.js can assert this route exposes the
// SAME function reference as the shared module, not a fourth copy — this used
// to be a byte-identical private copy of app/api/company-research/route.js's
// implementation before both moved to lib/llm/grounding.js.
export { extractGroundingSources };

// "how could current technology improve this project" — one page per
// request (see this chunk's own AC: a grounded search takes tens of
// seconds, so five pages in one request is a serverless timeout waiting to
// happen and makes partial success inexpressible). The client fans out with
// lib/tailor/runWithConcurrency.js at a cap of 3.

function reportTitle(pageTitle, when) {
  const iso = when.toISOString().slice(0, 10);
  return `Research: ${pageTitle || "Untitled page"} (${iso})`;
}

export async function POST(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!pageId) return badRequest("Missing pageId.");

  // The embedded engine has no offline equivalent for a search-grounded
  // report — every other AI feature in this repo has a deterministic local
  // path, but "what does live search say is current right now" cannot be
  // fabricated from the page's own text and presented as research. The
  // honest behavior is a clear refusal that creates no page, checked BEFORE
  // any data is even loaded.
  if (wantsEmbedded(body?.engine)) {
    return Response.json(
      { error: "A research report needs the Gemini engine. Switch off the embedded engine and try again." },
      { status: 503 },
    );
  }

  const { pages, error: pagesError } = await listPages(supabase, userId);
  if (pagesError) return Response.json({ error: pagesError }, { status: 500 });
  const page = (pages || []).find((p) => p.id === pageId);
  if (!page) return notFound("That page could not be found.");

  const { attachments, error: attachmentsError } = await listAttachments(supabase, userId, pageId);
  if (attachmentsError) return Response.json({ error: attachmentsError }, { status: 500 });

  const crumbs = breadcrumb(pages, pageId).map((c) => c.title);
  const childTitles = (pages || []).filter((p) => (p.parent_id ?? null) === pageId).map((p) => p.title);

  const prompt = buildResearchPrompt({
    page,
    breadcrumb: crumbs,
    childTitles,
    // Name and notes only — never the attachment's bytes. See
    // lib/experience/researchReport.js's own comment on buildResearchPrompt.
    attachments: (attachments || []).map((a) => ({ name: a.name, notes: a.notes })),
  });

  let model;
  let client;
  try {
    model = getServerEnv().geminiModel;
    client = getGeminiClient();
  } catch {
    return Response.json({ error: "Research needs the Gemini API key to be configured." }, { status: 503 });
  }

  let response;
  try {
    response = await client.models.generateContent({
      model,
      contents: prompt,
      tools: [{ googleSearch: {} }],
    });
  } catch (err) {
    console.error("Experience research failed:", err);
    return Response.json({ error: err?.message || "Research failed. Please try again." }, { status: 502 });
  }

  const rawText = String(response?.text || "").trim();
  if (!rawText) {
    return Response.json({ error: "The research came back empty. Try again." }, { status: 502 });
  }

  const groundedSources = extractGroundingSources(response);
  const { markdown, grounded } = reconcileCitations({ markdown: rawText, groundedSources });

  const now = new Date();
  const title = reportTitle(page.title, now);

  const { page: created, error: createError } = await createPage(supabase, userId, { title, parentId: pageId });
  if (createError) return Response.json({ error: createError }, { status: 500 });
  if (!created) return Response.json({ error: "Could not create the report page." }, { status: 500 });

  const { page: saved, error: saveError } = await updatePage(supabase, userId, created.id, { body: markdown });
  if (saveError) return Response.json({ error: saveError }, { status: 500 });

  // updatePage's fixed field list (title/body only — see
  // lib/supabase/experiencePages.js) has no room for the two generated_*
  // columns the migration in this chunk adds, and that file sits outside
  // this chunk's editable files. This write is scoped identically to every
  // write that file itself makes: by id AND user_id, never id alone.
  const generatedAt = now.toISOString();
  const { error: markError } = await supabase
    .from("experience_pages")
    .update({ generated_kind: "research", generated_at: generatedAt })
    .eq("id", created.id)
    .eq("user_id", userId);
  if (markError) {
    return Response.json({ error: markError.message || "Could not finalize the report page." }, { status: 500 });
  }

  const finalPage = { ...(saved || created), generated_kind: "research", generated_at: generatedAt };
  return Response.json({ page: finalPage, grounded });
}
