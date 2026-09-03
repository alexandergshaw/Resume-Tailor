// Chatbot helpers and handler factory. All chat-related functions live here;
// the host component passes its state, setters, refs, and a few helper
// utilities into `createChatHandlers` and gets back closures bound to that
// snapshot.

import { readEngine } from "@/app/settings/engine";
import { projectApplicationsForRequest } from "@/lib/chat/applicationContext";

// --- Request-size budget ----------------------------------------------------
//
// Vercel rejects an oversized request body before it ever reaches
// app/api/chat/route.js -- so that rejection carries whatever body the
// PLATFORM felt like sending (see readChatResponse below), not JSON.
//
// WHY 4_500_000, separating what's DOCUMENTED from what's INFERRED. An
// earlier version of this comment stated the inference below as settled
// fact -- it isn't, even though the conclusion (the constant) is still right.
//
// DOCUMENTED: Vercel's own docs give the request body limit as "4.5 MB", with
// no stated unit base (decimal vs. binary). AWS documents Lambda's
// synchronous-invocation payload limit as 6 MiB -- and documents the
// request-line/header/cookie limit as a SEPARATE quota row, not part of that
// 6 MiB body figure.
//
// INFERRED, and only an inference: that the body Vercel forwards to Lambda
// arrives base64-encoded. Neither company's docs say so either way. IF it
// does, the arithmetic ceiling is 6 MiB x 3/4 = 4_718_592 bytes -- exactly
// 4.5 MiB the BINARY reading, which lines up with Vercel's stated "4.5 MB"
// well enough to be a reasonable guess at what they mean, not a derivation
// from a sourced mechanism. A second, weaker inference this comment used to
// make -- that the same 6 MiB envelope also carries the request line, headers
// and cookies, leaving a usable body budget somewhat below 4_718_592 -- does
// NOT hold up: AWS lists those as the separate quota noted above, not a slice
// of the body limit. That justification has been dropped here; it doesn't
// follow from anything documented.
//
// The constant STAYS at 4_500_000 regardless of whether the base64 inference
// is right, because it sits safely under Vercel's documented "4.5 MB" either
// way -- the margin is deliberate slack against an unconfirmed mechanism, not
// a number derived from one. Cost of that choice, stated honestly: a body in
// [4_500_000, ~4_718_592) may be refused client-side even though the platform
// would have carried it. Raising the number toward the inferred ceiling trades
// that false refusal for a real 413 whose message is worse.
export const MAX_REQUEST_BYTES = 4_500_000;
// Reserved for everything in the body besides attachments: the message
// transcript, resumeText, the applications array, pinnedContext, and the JSON
// scaffolding around all of it.
export const CHAT_BODY_OVERHEAD_BYTES = 500_000;
// What's left for attachments, summed across the whole tray.
export const MAX_ATTACHMENT_PAYLOAD_BYTES = MAX_REQUEST_BYTES - CHAT_BODY_OVERHEAD_BYTES;
// The largest single binary file whose base64 form still fits the payload
// budget on its own: 4 * ceil(n/3) <= 4_000_000  =>  ceil(n/3) <= 1_000_000
// => n <= 3_000_000 decoded bytes. (The OLD gate was `5 * 1024 * 1024`, whose
// base64 form is ~6.99 MB -- ~55% over the transport limit above -- which is
// the root cause of the reported bug: an accepted file that always 413s.)
export const MAX_BINARY_ATTACHMENT_BYTES = 3_000_000;
// User-facing label for the per-file cap. Deliberately NOT "3 MB": macOS
// reports file sizes in decimal MB and Windows reports MiB under the same
// "MB" label, so a size just below the true byte cap under BOTH readings is
// the only value that is never a lie in either direction.
export const MAX_ATTACHMENT_SIZE_LABEL = "2.8 MB";
// M1: a .docx is a ZIP, so the per-file gate above deliberately does NOT
// apply to it (file.size is the COMPRESSED size and says nothing about how
// much text comes out -- see the aggregate check further down, which is the
// one that catches a small .docx with huge extracted text). But skipping the
// PAYLOAD cap is not the same as skipping every ceiling: with no ceiling at
// all, a 100 MB graphics-heavy resume -- or a decompression bomb -- goes
// straight into `JSZip.loadAsync` with nothing to stop it, freezing the tab.
// This is an absolute SOURCE-file ceiling, checked before extraction ever
// starts. 25 MB comfortably covers any real resume/cover-letter .docx.
export const MAX_DOCX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCX_SOURCE_LABEL = "25 MB";

// Base64 encodes 3 raw bytes as 4 characters, rounding the LAST group up to a
// full 4 characters (with `=` padding) rather than down. `n * 4 / 3` is the
// asymptotic ratio, not the actual length, and it always UNDER-counts -- which
// would leave a live failure band right at the top of the accepted range.
export function base64Length(n) {
  return 4 * Math.ceil(n / 3);
}

// M6: revoke an image attachment's preview blob URL so it doesn't leak for
// the page's remaining life. Guarded on `typeof URL` -- not just try/catch --
// because a node-environment test can be missing the `URL` global entirely,
// which throws on the PROPERTY LOOKUP `URL.revokeObjectURL` before the call
// itself ever happens. Prior art: app/hooks/useScreenshots.js:59,69.
export function revokeAttachmentPreview(entry) {
  if (!entry || !entry.previewUrl) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  try {
    URL.revokeObjectURL(entry.previewUrl);
  } catch {
    /* noop */
  }
}

// --- Reading the chat API's response ---------------------------------------
//
// NEVER call `response.json()` on this path. Vercel's platform-level 413 (body
// over MAX_REQUEST_BYTES) does not come back as JSON, so `.json()` throws a
// `SyntaxError` that used to land in the chat window verbatim.
//
// WHAT IS ACTUALLY KNOWN vs. what an earlier version of this comment asserted:
// Vercel does not document where that rejection is generated, nor the body or
// content-type it carries. The claim that it is "enforced at the edge, before
// route.js runs" and arrives as the plain text "Request Entity Too Large" is
// EMPIRICAL -- an observation, not a documented contract, and R-292 in
// docs/REGRESSION.md exists precisely because nobody in this repo has yet
// recorded the real status and content-type off a live deploy.
//
// The code is correct regardless, and that is the point: it reads the body as
// TEXT exactly once and classifies on the HTTP `status`, so it never depends
// on the response's shape. An empty body, an HTML error page, a JSON envelope
// or a bare string all land in the same place. Never harden this path against
// the literal string "Request Entity Too Large", and never reintroduce a
// content-type check -- both would bind the client to an undocumented detail
// the platform is free to change under us. Prior art:
// lib/llm/engines/externalEngine.js:57-66 ("413 returns an HTML page (not
// JSON), so it's handled separately").
const TOO_BIG_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total). ` +
  `Remove an attachment, or attach a smaller file, and try again.`;
// M4: "remove an attachment" is impossible advice when nothing is attached.
// `applicationsContext` (below) is now BOUNDED by projectApplicationsForRequest
// -- it no longer serializes every tracked application's full jobDescription
// and tailoredResume -- but it still carries EVERY tracked application, so a
// long enough history can still cross the cap with an empty tray. This branch
// names the real cause instead. (Scale, so nobody reads this as dead code: the
// unbounded shape crossed the cap at roughly 200 applications; the bounded one
// needs order 10^4. See docs/REGRESSION.md R-293.)
const TOO_BIG_NO_ATTACHMENTS_MESSAGE =
  `That message is too large to send (the platform limit is 4.5 MB total) — ` +
  `most likely from all your saved application history riding along, not an ` +
  `attachment. Try asking about one specific company or role, or send a ` +
  `shorter, smaller message, and try again.`;
const TIMED_OUT_MESSAGE = "That took too long and timed out. Please try again.";
const UNREACHABLE_MESSAGE =
  "Couldn't reach the assistant right now. Please try again in a moment.";
const INCOMPLETE_REPLY_MESSAGE =
  "The reply didn't come through completely. Please try again.";

// `hasAttachments` defaults to true so a caller that doesn't know about
// attachments (or doesn't pass the option at all) keeps getting the original
// wording verbatim -- only `runChatRequest` (which knows what it just sent)
// opts into the no-attachments branch.
export async function readChatResponse(response, { hasAttachments = true } = {}) {
  // Read the body EXACTLY ONCE, and only as text -- a second read of a real
  // `Response` throws "body stream already read", so this is a correctness
  // requirement, not a style choice.
  let raw;
  try {
    raw = await response.text();
  } catch {
    return { ok: false, error: UNREACHABLE_MESSAGE };
  }

  // Parse AFTER the read, in its own try. A non-JSON body (the platform 413,
  // an HTML error page) simply parses to nothing rather than throwing past
  // this function.
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (response.ok) {
    const reply = parsed && typeof parsed.reply === "string" ? parsed.reply : "";
    if (reply) return { ok: true, reply };
    return { ok: false, error: INCOMPLETE_REPLY_MESSAGE };
  }

  const { status } = response;

  // The route's own JSON error responses ("No messages provided.", "Could
  // not generate a reply.", "Empty response from Gemini.") are the one path
  // that already works today -- a real `{ error }` string wins verbatim over
  // any status-based classification below. BUT status 500 is route.js's
  // catch-all (`{ error: err?.message }`, app/api/chat/route.js:258), which
  // can carry a raw SDK/provider error string -- a bad Gemini key, an SDK
  // exception, a Supabase failure -- straight from `err.message`. That is the
  // exact class of leak this whole change exists to close, just arriving
  // through the 500 door instead of a thrown SyntaxError. Gating verbatim
  // pass-through OUT for 500 sends it to the generic UNREACHABLE_MESSAGE
  // below instead; the two routes that legitimately need verbatim text (400,
  // 502) are untouched, since neither of them is 500.
  if (status !== 500 && parsed && typeof parsed.error === "string" && parsed.error) {
    return { ok: false, error: parsed.error };
  }

  // Everything past here is classified on STATUS ONLY, never on content-type.
  // A platform-generated 413 can arrive as text/plain, text/html,
  // application/octet-stream, or no content-type header at all -- branching
  // on content-type instead falls through to `.json()` (or an equivalent
  // guess) for at least one of those shapes and reproduces the exact bug this
  // fix closes.
  if (status === 413) {
    return { ok: false, error: hasAttachments ? TOO_BIG_MESSAGE : TOO_BIG_NO_ATTACHMENTS_MESSAGE };
  }
  if (status === 504 || status === 408) return { ok: false, error: TIMED_OUT_MESSAGE };
  return { ok: false, error: UNREACHABLE_MESSAGE };
}

export function buildJobContextString(job) {
  const lines = [];
  if (job.title) lines.push(`Title: ${job.title}`);
  if (job.company) lines.push(`Company: ${job.company}`);
  if (job.location) lines.push(`Location: ${job.location}`);
  if (job.isRemote) lines.push(`Remote: yes`);
  if (job.employmentType) lines.push(`Employment Type: ${job.employmentType}`);
  if (job.publisher) lines.push(`Publisher: ${job.publisher}`);
  if (job.salaryMin || job.salaryMax) {
    lines.push(`Salary: ${job.salaryMin || "?"} – ${job.salaryMax || "?"}`);
  }
  if (job.url) lines.push(`URL: ${job.url}`);
  if (job.description) lines.push(`Description:\n${job.description}`);
  return lines.join("\n");
}

export function buildApplicationContextString(app, applicationStages) {
  const pos = app.positions || {};
  const resume = app.generated_resumes;
  const stages = applicationStages?.[app.id] || [];
  const lines = [];
  if (pos.company) lines.push(`Company: ${pos.company}`);
  if (pos.title) lines.push(`Role: ${pos.title}`);
  if (app.status) lines.push(`Status: ${app.status}`);
  if (app.applied_at) lines.push(`Applied: ${app.applied_at}`);
  if (app.application_url || pos.url) lines.push(`URL: ${app.application_url || pos.url}`);
  if (pos.description) lines.push(`Job Description:\n${pos.description}`);
  if (resume?.content) lines.push(`Tailored Resume:\n${resume.content}`);
  if (stages.length > 0) {
    lines.push("Interview Stages:");
    stages.forEach((s) => {
      const bits = [];
      if (s.stage_name) bits.push(s.stage_name);
      else if (s.stage_type) bits.push(s.stage_type);
      if (s.scheduled_at) bits.push(`@ ${s.scheduled_at}`);
      if (s.outcome && s.outcome !== "pending") bits.push(`(${s.outcome})`);
      if (Array.isArray(s.interviewer_names) && s.interviewer_names.length > 0) {
        bits.push(`with ${s.interviewer_names.join(", ")}`);
      }
      if (s.notes) bits.push(`notes: ${s.notes}`);
      lines.push(`  - ${bits.join(" ")}`);
    });
  }
  return lines.join("\n");
}

export function buildStageContextString(app, stage) {
  const pos = app.positions || {};
  const lines = [];
  if (pos.company) lines.push(`Company: ${pos.company}`);
  if (pos.title) lines.push(`Role: ${pos.title}`);
  lines.push(`Stage: ${stage.stage_name || stage.stage_type || "Interview"}`);
  if (stage.stage_type) lines.push(`Type: ${stage.stage_type}`);
  if (stage.scheduled_at) lines.push(`Scheduled: ${stage.scheduled_at}`);
  if (stage.duration_minutes) lines.push(`Duration: ${stage.duration_minutes} min`);
  if (stage.outcome) lines.push(`Outcome: ${stage.outcome}`);
  if (Array.isArray(stage.interviewer_names) && stage.interviewer_names.length > 0) {
    lines.push(`Interviewers: ${stage.interviewer_names.join(", ")}`);
  }
  if (stage.notes) lines.push(`Notes: ${stage.notes}`);
  if (pos.description) lines.push(`Job Description:\n${pos.description}`);
  return lines.join("\n");
}

export function createChatHandlers(deps) {
  const {
    // chat state values
    chatInput,
    chatMessages,
    chatSending,
    chatPinnedContext,
    chatAttachedFiles,
    chatSize,
    // chat state setters
    setChatInput,
    setChatMessages,
    setChatSending,
    setChatError,
    setChatOpen,
    setChatPinnedContext,
    setChatAttachedFiles,
    setChatAttachError,
    setChatSize,
    setChatResizing,
    // chat refs
    chatInputRef,
    // external state needed for the request payload
    resumeFile,
    applicationData,
    applicationStages,
    mainTab,
    activeSection,
    // helper utilities from the host component
    isDocxResume,
    isTextResume,
    buildTemplateLinesForUpload,
  } = deps;

  // Read a File as raw base64 (no data: prefix) for sending images/PDFs to the
  // model as inline data.
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("failed to read."));
      reader.readAsDataURL(file);
    });
  }

  // What an already-attached (or about-to-be-attached) entry actually costs
  // in the request body: a binary travels as base64 (`dataB64`), a text/.docx
  // entry travels as its own extracted `content` -- charging a text file its
  // base64-inflated size would refuse files that comfortably fit.
  function attachmentCost(entry) {
    if (entry.kind === "binary") return (entry.dataB64 || "").length;
    // m4: `content` travels as UTF-8 inside a JSON string, not UTF-16 code
    // units -- `.length` undercounts it. In a resume tool this is not an edge
    // case: accented characters, em dashes, and bullets cost 2-3 UTF-8 bytes
    // apiece, and every `\n` becomes the two JSON characters `\n` once
    // escaped. `dataB64` above is base64 (pure ASCII), so it needs no such
    // adjustment -- only the text/.docx path does.
    return new TextEncoder().encode(entry.content || "").length;
  }

  async function addChatAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    // Accumulate refusals instead of overwriting `chatAttachError` per file:
    // ExperienceTab.js's bulk "Ask AI about these attachments" hands over N
    // files the user never individually chose, and a message naming only the
    // last refusal reads as though the others attached fine.
    const errors = [];
    const accepted = [];
    // Running total of transmitted bytes: the existing tray, plus everything
    // ACCEPTED EARLIER IN THIS SAME BATCH, plus the file under consideration.
    // Reading only the snapshot `chatAttachedFiles` would let an entire batch
    // through even when its members jointly bust the budget.
    let runningTotal = (chatAttachedFiles || []).reduce((sum, f) => sum + attachmentCost(f), 0);

    for (const file of files) {
      if (!file) continue;
      const lowerName = (file.name || "").toLowerCase();
      const type = file.type || "";
      const isImage = type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(lowerName);
      const isPdf = type === "application/pdf" || lowerName.endsWith(".pdf");
      const isDocx = isDocxResume(file);
      const isTextLike =
        !isDocx &&
        (isTextResume(file) || /\.(txt|md|csv|json|log)$/i.test(lowerName) || (type && type.startsWith("text/")));

      // Per-file cap, keyed on `file.size` -- but NOT for `.docx`. A .docx is
      // a ZIP, so `file.size` is the COMPRESSED size and tells us nothing
      // about how much text comes out; a 300 KB resume can extract to 4.5 MB
      // of text. Only the aggregate check below (applied to the EXTRACTED
      // content, further down) can catch that case.
      if (!isDocx && file.size > MAX_BINARY_ATTACHMENT_BYTES) {
        errors.push(`${file.name} is too large (max ${MAX_ATTACHMENT_SIZE_LABEL}).`);
        continue;
      }
      // M1: the ABSOLUTE source-file ceiling for .docx (see the constant's
      // comment above) -- separate from, and checked before, the aggregate
      // check on EXTRACTED content further down. Without this a .docx of any
      // size sails past the per-file gate above and goes straight into
      // `buildTemplateLinesForUpload` -> `JSZip.loadAsync`.
      if (isDocx && file.size > MAX_DOCX_SOURCE_BYTES) {
        errors.push(`${file.name} is too large to open (max ${MAX_DOCX_SOURCE_LABEL} source file).`);
        continue;
      }

      try {
        let entry;
        if (isDocx) {
          const lines = await buildTemplateLinesForUpload(file);
          const content = (lines || []).join("\n").trim();
          if (!content) { errors.push(`${file.name}: no text could be extracted.`); continue; }
          entry = { name: file.name, kind: "text", content };
        } else if (isTextLike) {
          const content = (await file.text()).trim();
          if (!content) { errors.push(`${file.name}: no text could be extracted.`); continue; }
          entry = { name: file.name, kind: "text", content };
        } else if (isImage || isPdf) {
          const dataB64 = await readFileAsBase64(file);
          if (!dataB64) { errors.push(`${file.name}: could not read file.`); continue; }
          const mimeType = type || (isPdf ? "application/pdf" : "image/png");
          entry = {
            name: file.name,
            kind: "binary",
            mimeType,
            dataB64,
            previewUrl: isImage ? URL.createObjectURL(file) : null,
          };
        } else {
          errors.push(`${file.name}: unsupported type. Use text, .docx, images, or PDF.`);
          continue;
        }

        const cost = attachmentCost(entry);
        if (runningTotal + cost > MAX_ATTACHMENT_PAYLOAD_BYTES) {
          // m3: `runningTotal` here is everything ALREADY accepted (the prior
          // tray plus anything accepted earlier in this same batch) -- when
          // it's zero, this file busts the budget entirely BY ITSELF, and
          // there is nothing else to "remove" (the M1 case: one oversized
          // .docx, empty tray). Naming a nonexistent tray there is exactly
          // the impossible-advice defect M4 fixes elsewhere, so branch the
          // same way here, and state the actual total either way.
          const totalMB = ((runningTotal + cost) / 1_000_000).toFixed(1);
          errors.push(
            runningTotal > 0
              ? `${file.name} would push the attachments over the total limit (${totalMB} MB) — remove one and try again.`
              : `${file.name} is too large on its own (${totalMB} MB) to attach — try a smaller file.`,
          );
          continue;
        }
        runningTotal += cost;
        accepted.push(entry);
      } catch (err) {
        errors.push(`${file.name}: ${err.message || "failed to read."}`);
      }
    }
    setChatAttachError(errors.join(" "));
    if (accepted.length > 0) {
      setChatAttachedFiles((prev) => [...prev, ...accepted]);
      setChatOpen(true);
    }
  }

  function askAiAbout({ label, content, prompt = "", sourceJobId = null }) {
    setChatPinnedContext({ label: label || "Context", content: content || "", sourceJobId: sourceJobId || null });
    setChatError("");
    // Always prefix any button-triggered chat with a consistent
    // "I need help with <origin>" opener so we (and the model) know where
    // the conversation came from. The `prompt` argument is intentionally
    // ignored — callers used to supply ad-hoc starters; this unifies them.
    void prompt;
    const origin = (label || "this").toString().trim() || "this";
    setChatInput(`I need help with ${origin}: `);
    setChatOpen(true);
    setTimeout(() => {
      const el = chatInputRef.current;
      if (!el) return;
      try {
        el.focus();
        const len = el.value?.length ?? 0;
        if (typeof el.setSelectionRange === "function") {
          el.setSelectionRange(len, len);
        }
      } catch {
        /* noop */
      }
    }, 80);
  }

  async function runChatRequest(text, baseMessages) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    // A retry must not GROW the request: if the base transcript already ends
    // with a turn we marked `failed`, drop it here so this attempt reuses
    // that slot instead of appending a second, larger copy of the same turn.
    // `resendUserMessage`'s own `slice(0, index)` already excludes the turn
    // being resent (it never ends in a trailing failed turn that belongs to
    // THIS call), so this is a no-op there.
    const cleanedBase = Array.isArray(baseMessages) ? [...baseMessages] : [];
    const lastBase = cleanedBase[cleanedBase.length - 1];
    if (lastBase && lastBase.role === "user" && lastBase.failed) {
      cleanedBase.pop();
    }
    const userMsg = { role: "user", content: trimmed };
    const nextMessages = [...cleanedBase, userMsg];
    setChatMessages(nextMessages);
    setChatError("");
    setChatSending(true);
    try {
      let resumeText = "";
      if (resumeFile) {
        try {
          const lines = await buildTemplateLinesForUpload(resumeFile);
          resumeText = (lines || []).join("\n").trim();
        } catch {
          resumeText = "";
        }
      }

      const mappedApplications = (applicationData || []).map((app) => {
        const pos = app.positions || {};
        const resume = app.generated_resumes;
        // m11: `buildApplicationContextString` (this file, above) already
        // uses `?.` here -- without it, a missing `applicationStages` map
        // throws a raw TypeError that lands as a "failed" turn showing the
        // user a bare JS message instead of a chat reply.
        const stages = applicationStages?.[app.id] || [];
        return {
          company: pos.company || null,
          role: pos.title || null,
          status: app.status || null,
          appliedAt: app.applied_at || null,
          applicationUrl: app.application_url || pos.url || null,
          jobDescription: pos.description || null,
          tailoredResume: resume?.content || null,
          stages: stages.map((s) => ({
            name: s.stage_name || null,
            type: s.stage_type || null,
            scheduledAt: s.scheduled_at || null,
            outcome: s.outcome || null,
            // `interviewers` and `notes` are built here and then DELIBERATELY
            // DISCARDED by projectApplicationsForRequest below -- it rebuilds
            // each stage as {name, type, scheduledAt, outcome} only, because
            // no consumer of `body.applications` reads either field
            // (route.js's renderer and localAssistant.js both stop at
            // outcome). They are not lost to the product: interviewer names
            // and stage notes still travel to the model through
            // `buildApplicationContextString` / `buildStageContextString`
            // (this file, above), which render RAW Supabase rows into
            // `pinnedContext.content` -- a different body field entirely. If
            // you need them in a chat answer, add them to the allowlist in
            // lib/chat/applicationContext.js; reading them off this array
            // downstream will just yield `undefined`.
            interviewers: s.interviewer_names || [],
            notes: s.notes || null,
          })),
        };
      });

      // Bound (not trim) the heavy per-application fields before they go on
      // the wire: every application's scheduled dates and stage
      // name/type/outcome survive, in order, for the whole tracked history
      // (`stages[].interviewers` and `stages[].notes` are dropped -- see the
      // note in the map above), but jobDescription/tailoredResume are
      // capped for the first MAX_APPLICATIONS applications (the only ones
      // route.js's Gemini renderer ever shows) and dropped entirely past
      // that, where they were never rendered anyway. See
      // lib/chat/applicationContext.js for the full contract and
      // lib/chat/applicationContext.test.js for the proof that this is
      // byte-identical to sending the unbounded array, for both consumers.
      const applicationsContext = projectApplicationsForRequest(mappedApplications);

      // M2/M6: snapshot the tray that is ACTUALLY going into this request's
      // body, before anything async below can let a re-render swap in a
      // newer `chatAttachedFiles`. Neither the `+ File` button nor the drop
      // handler is disabled while sending, so a user can attach a fresh file
      // while "Thinking…" is showing -- clearing the tray wholesale on
      // success would silently delete that file even though it was never
      // sent. Filtering by reference against THIS snapshot (below) removes
      // only what this request actually carried.
      const sentAttachments = chatAttachedFiles || [];
      const hasAttachments = sentAttachments.length > 0;

      const requestBody = JSON.stringify({
        messages: nextMessages,
        resumeText,
        applications: applicationsContext,
        pinnedContext: chatPinnedContext
          ? { label: chatPinnedContext.label, content: chatPinnedContext.content }
          : null,
        attachedFiles: sentAttachments.map((f) =>
          f.kind === "binary"
            ? { name: f.name, mimeType: f.mimeType, dataB64: f.dataB64 }
            : { name: f.name, content: f.content },
        ),
        tab: mainTab,
        section: activeSection,
        // Embedded engine answers from context offline; otherwise Gemini.
        engine: readEngine(),
      });

      // M4: MEASURE, don't trim -- and, as of the projection above, BOUNDED
      // rather than unbounded. `applicationsContext` no longer serializes
      // every tracked application's full jobDescription and tailoredResume:
      // projectApplicationsForRequest caps those two fields for the first
      // MAX_APPLICATIONS applications and nulls them past that, the same
      // slice route.js's Gemini renderer already used. It drops NO
      // application, NO scheduled date and NO stage name/type/outcome --
      // localAssistant.js (:162-167) iterates ALL applications for scheduled
      // interviews, and every one of them, with every stage field either
      // consumer reads, is still on the wire. (`stages[].interviewers` and
      // `stages[].notes` ARE dropped; nothing reading this array reads them.
      // See the map above.) This gate still
      // measures the body BEFORE sending and refuses rather than shrinking
      // further, because a body still over the cap after the bound above has
      // no lossless remedy left here -- it needs the platform's own message,
      // not a client-side guess at what to cut.
      const bodyBytes = new TextEncoder().encode(requestBody).length;
      if (bodyBytes > MAX_REQUEST_BYTES) {
        throw new Error(hasAttachments ? TOO_BIG_MESSAGE : TOO_BIG_NO_ATTACHMENTS_MESSAGE);
      }

      let response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
      } catch (fetchErr) {
        // A REJECTED fetch means no response ever arrived -- no status to
        // classify, and the raw "Failed to fetch" TypeError is not something
        // a job-seeker can act on. Prior art: app/hooks/useScreenshots.js:159-171.
        const msg = fetchErr?.message || "";
        const networkish =
          fetchErr?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(msg);
        throw new Error(
          networkish
            ? "Couldn't reach the server — check your internet connection and try again."
            : msg || "Chat request failed.",
        );
      }

      const result = await readChatResponse(response, { hasAttachments });
      if (!result.ok) throw new Error(result.error);

      // The turn succeeded, so every attachment THIS REQUEST carried was
      // delivered -- remove only those entries (by reference against the
      // snapshot above), revoking each one's preview blob URL as it goes
      // (M6). A wholesale `setChatAttachedFiles([])` here would also destroy
      // any file the user attached mid-flight (M2) and leak its blob URL.
      setChatAttachedFiles((prev) => {
        const remaining = [];
        for (const f of prev) {
          if (sentAttachments.includes(f)) {
            revokeAttachmentPreview(f);
          } else {
            remaining.push(f);
          }
        }
        return remaining;
      });
      setChatMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    } catch (err) {
      // A FAILED send must never destroy the user's attachments -- they would
      // have to re-pick and re-read the same files on every retry. Instead,
      // mark the just-sent user turn `failed` in place; the next call through
      // here strips a trailing failed turn (see above) and reuses the slot
      // rather than growing the transcript.
      setChatMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx].role === "user") {
          updated[lastIdx] = { ...updated[lastIdx], failed: true };
        }
        return updated;
      });
      setChatError(err.message || "Chat request failed.");
    } finally {
      setChatSending(false);
    }
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatInput("");
    await runChatRequest(text, chatMessages);
  }

  // Resend a previously-sent user message. Truncates the conversation so that
  // message becomes the most recent turn, then re-fires the request so the
  // assistant produces a fresh reply.
  async function resendUserMessage(index) {
    if (chatSending) return;
    const msg = chatMessages[index];
    if (!msg || msg.role !== "user") return;
    const baseMessages = chatMessages.slice(0, index);
    await runChatRequest(msg.content, baseMessages);
  }

  function startChatResize(event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = chatSize.width;
    const startH = chatSize.height;
    setChatResizing(true);
    function onMove(e) {
      // Panel is anchored to the right/bottom, so grow it as the user drags up/left.
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxW = Math.max(280, window.innerWidth - 32);
      const maxH = Math.max(320, window.innerHeight - 32);
      const nextW = Math.min(maxW, Math.max(280, startW - dx));
      const nextH = Math.min(maxH, Math.max(320, startH - dy));
      setChatSize({ width: nextW, height: nextH });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setChatResizing(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  }

  return {
    addChatAttachments,
    askAiAbout,
    runChatRequest,
    sendChatMessage,
    resendUserMessage,
    startChatResize,
  };
}
