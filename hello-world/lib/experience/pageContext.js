// What "Ask AI" pins to the chat when pressed on a Professional Experience
// project page: the page's own title/breadcrumb/body, its child pages, and
// an inventory of its attachments. Pure - no fetch, no Supabase, no React -
// so the same budget logic is provable in isolation from how the caller got
// the data. See pageContext.test.js for the contract this file exists to
// satisfy; its comments explain WHY each rule below is here, not just what.
//
// The one rule worth restating here: app/api/chat/route.js caps a pinned
// context at 12000 chars (MAX_RESUME_CHARS) and truncates anything longer
// with a bare "…" - no notice, nothing the model or the user can see. That
// silent cut is the actual defect this module exists to prevent. So this
// file's own budget (MAX_CONTEXT_CHARS) is set at that same ceiling, spent
// deliberately in a fixed priority order (title/breadcrumb first, then the
// attachment inventory, then as much of the body as still fits), and any
// shortfall is written into the content itself as a plain-English notice -
// never a bare slice.

export const MAX_CONTEXT_CHARS = 12000;

// Reserved out of the budget for the truncation notice itself, computed
// AFTER we already know the head (title/breadcrumb/child-pages/attachments)
// and body have been sized - the notice is assembled last, so its own
// length must be pre-budgeted rather than fought over with the body. Sized
// generously above the worst realistic notice string (see the three phrases
// assembled below) so the notice is never itself the thing that gets cut.
const NOTICE_RESERVE_CHARS = 300;

// How many child pages / attachments get listed by name before the rest are
// summarized as "N more not included". Keeps the head (the part that must
// NEVER be cut, per "keeps the title and breadcrumb even when the body must
// be cut" and "keeps the attachment inventory even when the body must be
// cut" below) bounded, so a page with an unreasonable number of children or
// attachments cannot itself starve the whole budget the way an unbounded
// body could.
const MAX_LISTED_CHILD_PAGES = 60;
const MAX_LISTED_ATTACHMENTS = 60;

// Per-entry safety cap on a single note/transcript field. Not exercised by
// the gate test's fixtures (all short strings), but without it one
// pathologically long note could alone consume the whole attachment-list
// share of the budget and crowd out every other attachment's own line.
const MAX_FIELD_CHARS = 600;

function str(value) {
  return typeof value === "string" ? value : "";
}

function clip(value, max) {
  if (value.length <= max) return value;
  // Code-point aware would matter for surrogate pairs, but every field this
  // clips is free-text notes/titles where a plain slice plus an ellipsis is
  // an acceptable (and clearly visible) loss - unlike a storage filename,
  // nothing here round-trips anywhere.
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function formatBreadcrumb(breadcrumb) {
  const parts = (Array.isArray(breadcrumb) ? breadcrumb : [])
    .map((entry) => (typeof entry === "string" ? entry : str(entry?.title)))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.join(" / ");
}

function formatChildPages(childPages) {
  const list = (Array.isArray(childPages) ? childPages : []).filter(Boolean);
  if (list.length === 0) return { text: "", dropped: 0 };
  const shown = list.slice(0, MAX_LISTED_CHILD_PAGES);
  const dropped = list.length - shown.length;
  const lines = shown.map((entry) => {
    const title = str(entry?.title).trim() || "Untitled page";
    return `- ${clip(title, MAX_FIELD_CHARS)}`;
  });
  return { text: lines.join("\n"), dropped };
}

export function attachmentKindLabel(kind) {
  if (kind === "image") return "image";
  if (kind === "pdf") return "PDF";
  if (kind === "video") return "video";
  if (kind === "text") return "text file";
  if (kind === "slides") return "slide deck";
  if (kind === "sheet") return "spreadsheet";
  if (kind === "archive") return "archive";
  return "file";
}

// One attachment's line in the inventory. Reads ONLY name/kind/notes/
// transcript - never bytes, storage_path, url, or any other field a raw
// attachment row might carry, so this is the enforcement point for "never
// includes attachment bytes or storage paths" regardless of what shape the
// caller's row happens to be.
//
// Guard fix (see lib/copilot/groundingNotice.js's comment above
// submittedDocsClause for the precedent this follows): this helper used to
// be module-private with exactly one caller, formatAttachments, which
// always pre-filtered its list to real objects before calling - so a bad
// row here was unreachable and the `name` default (`|| "Untitled file"`)
// never actually fired. Making this a public export removes that
// guarantee: a public export has no way to promise that its one careful
// caller stays its only caller. Left unguarded, `formatAttachment(null)`
// would fall through the same default and silently mint
// `- Untitled file (file)` - an inventory line for a file that does not
// exist. So the precondition formatAttachments used to enforce is now
// checked here instead: anything that is not a non-null object, or whose
// `name` is missing/blank after trimming, is not a usable attachment and
// produces no line at all.
export function formatAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return "";
  const name = str(attachment.name).trim();
  if (!name) return "";
  const kind = str(attachment.kind).trim();
  const notes = clip(str(attachment.notes).trim(), MAX_FIELD_CHARS);
  const transcript = clip(str(attachment.transcript).trim(), MAX_FIELD_CHARS);

  if (kind === "video") {
    // Video bytes are never sent to the model (see app/api/chat/route.js -
    // only image/* and application/pdf are forwarded as inline data). Notes
    // and a cached transcript are the ONLY things the model will ever know
    // about this file, which is exactly why an empty pair must say so in
    // plain words instead of leaving a bare filename that reads as though
    // the model watched it.
    const bits = [];
    if (notes) bits.push(`notes: ${notes}`);
    if (transcript) bits.push(`transcript: ${transcript}`);
    const detail = bits.length > 0
      ? bits.join("; ")
      : "no notes and no transcript available - this video was not watched or transcribed";
    return `- ${name} (video) - ${detail}`;
  }

  const label = attachmentKindLabel(kind);

  // slides/sheet/archive, and only these three, get a per-line "contents
  // not read". Everything else in DOWNLOADABLE_ATTACHMENT_KINDS (image, pdf,
  // text - see app/components/experience/ExperienceTab.js) is downloaded
  // and handed to the model as a real file in the SAME Ask AI request that
  // pins this context, so disclaiming those three would tell the model the
  // opposite of what just happened. A deck or a spreadsheet is downloaded by
  // nothing (no path here parses OOXML), and an archive is downloaded by
  // nothing either (nothing in this repo unzips anything, so a zip's bytes
  // are never sent to the model) - so for all three, name and notes are
  // genuinely the whole of what the model ever learns - the one kind of
  // claim this file must get right per line, not on a shared header that
  // would misdescribe the other three.
  if (kind === "slides" || kind === "sheet" || kind === "archive") {
    return notes
      ? `- ${name} (${label}) - contents not read - notes: ${notes}`
      : `- ${name} (${label}) - contents not read`;
  }

  return notes ? `- ${name} (${label}) - notes: ${notes}` : `- ${name} (${label})`;
}

function formatAttachments(attachments) {
  const list = (Array.isArray(attachments) ? attachments : []).filter(
    (entry) => entry && typeof entry === "object",
  );
  if (list.length === 0) return { text: "", dropped: 0 };
  const shown = list.slice(0, MAX_LISTED_ATTACHMENTS);
  const dropped = list.length - shown.length;
  // .filter(Boolean): formatAttachment's own guard (see its comment) now
  // returns "" for an object that isn't a usable attachment - e.g. one with
  // a missing/blank name, which the object-shape filter above does not
  // catch. Without dropping those here, one bad row would still pass this
  // module's own honesty rules but leave a blank line sitting inside an
  // otherwise-real inventory.
  return { text: shown.map(formatAttachment).filter(Boolean).join("\n"), dropped };
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// buildPageContext({ page, breadcrumb, childPages, attachments }) ->
// { label, content, truncated }.
//
// `label` is what the chat opener names ("I need help with <label>: ") -
// always just the page title.
//
// `content` is the pinned-context body: title, breadcrumb, child-page
// titles, and the attachment inventory (the "head" - never truncated
// internally beyond MAX_LISTED_* above) followed by as much of the page
// body as the remaining budget allows, followed by a notice naming
// whatever was left out, if anything was.
//
// `truncated` is true the moment ANY of the body, the child-page list, or
// the attachment list had to drop something to fit - never inferred from
// content.length alone, so a caller can act on it directly.
export function buildPageContext(input) {
  const src = input && typeof input === "object" ? input : {};
  const page = src.page && typeof src.page === "object" ? src.page : {};
  const title = str(page.title).trim() || "Untitled page";
  const body = str(page.body);

  const breadcrumbText = formatBreadcrumb(src.breadcrumb);
  const { text: childText, dropped: childDropped } = formatChildPages(src.childPages);
  const { text: attachmentText, dropped: attachmentDropped } = formatAttachments(src.attachments);

  const headLines = [`Project: ${title}`];
  if (breadcrumbText) headLines.push(`Path: ${breadcrumbText}`);
  if (childText) headLines.push(`Sub-pages:\n${childText}`);
  if (attachmentText) headLines.push(`Attachments:\n${attachmentText}`);
  const head = headLines.join("\n\n");

  // What's left for the body once the head (never cut, see above) and a
  // reserve for the notice (written last, only if actually needed) are both
  // accounted for. The "\n\n" joins below cost 2 chars each; "Body:\n"
  // costs 6 - budgeted here rather than discovered after the fact.
  const budgetForBody = Math.max(
    0,
    MAX_CONTEXT_CHARS - head.length - NOTICE_RESERVE_CHARS - "\n\n".length - "Body:\n".length,
  );

  const bodyTruncated = body.length > budgetForBody;
  const bodyText = bodyTruncated ? body.slice(0, budgetForBody) : body;

  const notices = [];
  if (bodyTruncated) notices.push("the body was truncated to fit the AI context budget");
  if (childDropped > 0) notices.push(`${pluralize(childDropped, "sub-page")} not included`);
  if (attachmentDropped > 0) notices.push(`${pluralize(attachmentDropped, "attachment")} not included`);

  const truncated = notices.length > 0;
  const noticeBlock = truncated
    ? `[Note: ${notices.join("; ")} - content was shortened to fit the AI context budget.]`
    : "";

  const bodyBlock = bodyText ? `Body:\n${bodyText}` : "";

  let content = [head, bodyBlock, noticeBlock].filter(Boolean).join("\n\n");

  // Defensive final clamp: the budgeting above is designed to always hold,
  // but if some future change to the head/notice shapes ever overshoots it
  // anyway, the hard contract (content never exceeds MAX_CONTEXT_CHARS) must
  // still hold rather than silently breaking it. Cuts only from the very
  // end - the head and the body both already precede the notice in
  // `content`, so a tail cut can only ever remove notice text, never the
  // title/breadcrumb/attachment inventory the earlier truncation tests
  // depend on.
  if (content.length > MAX_CONTEXT_CHARS) {
    content = content.slice(0, MAX_CONTEXT_CHARS);
  }

  return { label: title, content, truncated };
}
