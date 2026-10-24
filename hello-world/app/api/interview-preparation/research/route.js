import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { wantsEmbedded } from "@/lib/llm/featureEngine";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { buildInterviewResearchPrompt, buildInterviewResearchResult } from "@/lib/interviewPreparation/interviewResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const limiter = createRateLimiter({ limit: 4, windowMs: 600000, prefix: "interview-process-research" });
async function readBody(request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("Missing request body.");
  const chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error("Research request is too large."); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export async function POST(request) {
  if (process.env.PREP_DISABLED === "1") return Response.json({ error: "Interview research is disabled." }, { status: 503 });
  const { supabase, userId } = await getAuth(); if (!userId) return unauthorized();
  const decision = await limiter.check(identify(request, { userId }));
  if (!decision.allowed) return Response.json({ error: "Too many interview research requests. Wait before trying again." }, { status: 429, headers: rateLimitHeaders(decision) });
  let body; try { body = await readBody(request); } catch { return badRequest("Invalid or oversized research request (4 KB maximum)."); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["applicationId", "engine"].includes(key)) || typeof body.applicationId !== "string" || !body.applicationId.trim() || body.applicationId.length > 200 || !["gemini", "embedded", "external"].includes(body.engine)) return badRequest("Choose an application and a valid engine.");
  const applicationId = body.applicationId.trim();
  const { data: appRow, error } = await supabase.from("applications").select("id,user_id,positions(id,title,company,location,description)").eq("id", applicationId).eq("user_id", userId).maybeSingle();
  if (error) return Response.json({ error: "Could not load this application. Your previous plan is retained." }, { status: 500 });
  if (!appRow) return notFound("Application not found.");
  if (body.engine !== "gemini" || String(process.env.RESUME_ENGINE || "").trim().toLowerCase() === "embedded") return Response.json({ error: "Interview research needs the Gemini engine. Embedded and external modes do not perform this research; the server may also require Embedded mode." }, { status: 503 });
  const position = appRow.positions || {}; const company = typeof position.company === "string" ? position.company.trim() : ""; const title = typeof position.title === "string" ? position.title.trim() : "";
  const location = typeof position.location === "string" ? position.location.trim() : ""; const description = typeof position.description === "string" ? position.description : "";
  let prompt; try { prompt = buildInterviewResearchPrompt({ company, title, location, description }).prompt; } catch { return badRequest("This application needs a valid company and role before research can run."); }
  let client; let model; try { model = getServerEnv().geminiModel; client = getGeminiClient(); } catch { return Response.json({ error: "Interview research needs the Gemini API key to be configured." }, { status: 503 }); }
  if (wantsEmbedded(undefined, process.env) || wantsEmbedded(body.engine, process.env)) return Response.json({ error: "Interview research is unavailable: configure the Gemini API key on the server." }, { status: 503 });
  try {
    const interaction = await client.interactions.create({ model, input: prompt, tools: [{ type: "google_search" }], store: false }, { timeout: 45000, maxRetries: 0 });
    const result = await buildInterviewResearchResult({ interaction, applicationId, company, title, location, description, researchedAt: new Date().toISOString() });
    return Response.json({ result });
  } catch { return Response.json({ error: "Interview research could not return a complete, safely cited plan. Your previous plan and edits are retained; retry explicitly." }, { status: 502 }); }
}
