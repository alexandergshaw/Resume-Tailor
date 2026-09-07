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
//
// AND THE MODULE COMMITTED IT ITSELF, which is the part worth reading before
// changing anything below. The head (title, breadcrumb, sub-pages, attachments)
// was built unconditionally and only then subtracted from the body's budget, so
// nothing anywhere capped what the head COST - only how many lines it held and
// how long each line was. Sixty sub-pages of three hundred characters each broke
// no cap and produced a head of ~18800 characters; the body budget floored at
// zero, no notice was assembled, and the defensive clamp at the bottom of this
// file cut the overflow off the tail. Measured: content exactly 12000 chars,
// `truncated: false`, no notice, twenty sub-pages destroyed - the caller told in
// so many words that nothing had been cut. See MAX_HEAD_CHARS and capListLines
// for the bound that closes it, and note the shape of the failure: every
// individual rule was obeyed and the total was still unbounded.
//
// AND NEVER A BARE COUNT EITHER, which is the second half of the same rule and
// the half this file used to fail. Both lists below stop at 60 and the notice
// reported an integer - "3 sub-pages not included" - which tells the reader
// that the model is answering about a project with a hole in it and gives them
// no way to learn where the hole is. Both caps are a PREFIX CUT, so the dropped
// items are exactly the tail of a list already in hand; the identity was never
// hard to recover, it simply was not returned. It is now, both in the notice
// (the model is the only reader of this string - see buildPageContext's own
// comment) and in the returned `droppedChildPages`/`droppedAttachments`, so
// app/components/experience/ExperienceTab.js can surface it to the human
// without re-deriving a set it does not own. See lib/experience/tailorContext.js
// for the same fix on the tailoring prompt, and lib/experience/droppedNames.js
// for why the names have to be rationed inside NOTICE_RESERVE_CHARS rather than
// allowed to grow it.

import { formatDroppedNames } from "./droppedNames.js";

export const MAX_CONTEXT_CHARS = 12000;

// Reserved out of the budget for the truncation notice itself, computed
// AFTER we already know the head (title/breadcrumb/child-pages/attachments)
// and body have been sized - the notice is assembled last, so its own
// length must be pre-budgeted rather than fought over with the body. Sized
// generously above the worst realistic notice string (see the three phrases
// assembled below) so the notice is never itself the thing that gets cut.
//
// EXPORTED so pageContext.test.js can assert the assembled notice fits inside
// it rather than hardcoding 300 a second time - the property that matters is
// "the notice never exceeds its own reserve", and a test carrying a private
// copy of the number would keep passing if this one moved. Naming the dropped
// items made that property load-bearing: a count-only sentence could never
// approach 300, a name list can pass it without trying.
//
// AND IT PAYS FOR THE BLOCK_JOIN THAT ATTACHES THE NOTICE — see that constant.
// The reserve is what the notice costs the budget, and the notice cannot appear
// in `content` without the blank line that attaches it, so that blank line is
// part of what it costs.
export const NOTICE_RESERVE_CHARS = 300;

// How many child pages / attachments get listed by name before the rest are
// summarized as "N more not included". A cap on how much of a list a reader can
// usefully take in - sixty names is already more than anyone reads.
//
// NOT A BUDGET, and this comment used to claim it was one. It said these caps
// "keep the head bounded, so a page with an unreasonable number of children or
// attachments cannot itself starve the whole budget the way an unbounded body
// could". That was false, and the falsehood was the defect: sixty is a bound on
// LINES, MAX_FIELD_CHARS is a bound on each line, and sixty times six hundred is
// three times the whole context budget. What actually bounds the head is
// MAX_HEAD_CHARS, applied alongside these caps by capListLines below.
//
// Exported for the same reason as the reserve above: the tests that pin what
// happens at the 60th and 61st entry have to be written against the real cap,
// or an off-by-one here silently becomes an off-by-one there too.
export const MAX_LISTED_CHILD_PAGES = 60;
export const MAX_LISTED_ATTACHMENTS = 60;

// The display name a dropped item takes when it has none of its own. The tree
// creates pages titled "", and people write a body before naming it, so a
// nameless child page is ordinary rather than a fixture. It must match what
// formatChildPages already writes on the line ABOVE the notice - the reader
// should not be hunting for two different things - and it must never be an
// empty string (`“”` reads as "a page called nothing") or a raw id.
const UNTITLED_CHILD_PAGE = "Untitled page";

// The blank line between two top-level blocks of `content` — head, body block,
// notice — named because it is SPENT in one place (the join at the end of
// buildPageContext) and BUDGETED in two others, and one of the two used to be
// missing entirely.
//
// EACH BLOCK PAYS FOR THE JOIN THAT ATTACHES IT, which is the whole rule, and
// the only one that stays right for a join over a VARIABLE number of blocks.
// `content` is a three-part join, so it spends this separator twice when all
// three blocks are present, once when two are, and not at all for the head
// alone. Charging a fixed count to any single block therefore has to be wrong
// in one direction or the other. Charging each block for its own attachment is
// exact in every shape: `budgetForBody` subtracts one (the join to the head,
// which the body cannot appear without), NOTICE_RESERVE_CHARS covers one (the
// join to whatever precedes the notice, likewise), and a call that assembles no
// notice spends no second join and is charged for none.
//
// THE DEFECT THIS CLOSES, because it is invisible from outside. `budgetForBody`
// subtracted ONE "\n\n" while the three-part join above spends TWO — under a
// comment that said the joins "cost 2 chars each", plural, which is what makes
// this an arithmetic slip rather than a design choice. So a body filling
// budgetForBody, plus a notice filling NOTICE_RESERVE_CHARS, plus both joins,
// came to MAX_CONTEXT_CHARS + 2, and the defensive clamp cut the overflow off
// the TAIL — precisely where the notice sits. The reader got
// `…shortened to fit the AI context budget` with its own ".]" eaten: a sentence
// that reads as a rendering failure while reporting the one thing the reader
// most needs to trust. No test could see it, because `content.length <= MAX` is
// true in the broken case too — the clamp made it true.
//
// CHARGED TO THE RESERVE, NOT TO THE BODY, and that is the decision rather than
// the arithmetic. Subtracting a second join from `budgetForBody` (or,
// identically, growing NOTICE_RESERVE_CHARS to 302) costs two characters of the
// user's own page on EVERY call — including the overwhelming majority that drop
// nothing, assemble no notice, and never spend this join at all. Charging it to
// the reserve costs at most two characters off a dropped-page NAME, in the one
// call where the notice is already at its longest, which is exactly the
// trade-off assembleNotice's own comment below already commits to.
//
// WHY THE WORST CASE IS NOT THE ONE lib/meeting/meetingContext.js FIXED, though
// the shape and the remedy are the same: there the overflow needs a TRUNCATED
// body. Here a truncated body adds a second clause to the notice, which eats
// the room the name list needed — so the two- and three-clause notices stay
// inside the budget on their own. What overflows here is a one-clause notice
// beside a body of EXACTLY budgetForBody, which is not truncated at all. See
// pageContext.test.js, which measures both boundaries rather than assuming
// either.
//
// WHY lib/experience/knowledgeBase.js NEEDS NO SUCH CONSTANT, though its
// assembly is the same shape with the same tail clamp: its notice is count-only
// by deliberate design, so its reserve holds a notice that cannot come close to
// filling it, and the permanent slack absorbs its join by accident. That remedy
// — "the notice can never fill the reserve" — is true there and false here BY
// DESIGN: assembleNotice below spends this reserve down to its last character
// on purpose.
const BLOCK_JOIN = "\n\n";

// Separates a count clause from the names that qualify it, e.g.
// "2 sub-pages not included: “Rollout plan”, “Risks”".
const NAME_CLAUSE_JOIN = ": ";

// The newline between two lines WITHIN one list (sub-pages, attachments), as
// distinct from BLOCK_JOIN between top-level blocks. Named for the same reason:
// capListLines budgets it and the join inside capListLines spends it.
const LINE_JOIN = "\n";

// The most the head may cost, and the constant whose absence WAS the defect -
// see capListLines above for the measurement.
//
// WHY MAX - RESERVE RATHER THAN MAX. It makes the notice unconditionally
// affordable: a head at its cap plus BLOCK_JOIN plus a notice spending the whole
// reserve comes to exactly MAX_CONTEXT_CHARS, so the sentence reporting a loss
// can never itself be the thing a clamp eats. That is the guarantee "reserve for
// the notice before building the head" was after, obtained here as a consequence
// of bounding the head rather than as a second mechanism.
//
// AND IT MAKES THE THREE BUILDERS AGREE. lib/meeting/meetingContext.js's
// `budgetForPages` and lib/experience/knowledgeBase.js's are both exactly their
// own budget minus their own reserve; both measure every byte of every block
// against it before admitting the block, which is why neither has a head that
// can escape. This module now states the same invariant: head plus body block
// plus their join never exceeds MAX_CONTEXT_CHARS - NOTICE_RESERVE_CHARS, which
// is the quantity pageContext.test.js's "charges the join to the reserve" case
// already pins from the body's side.
//
// THE PRICE, stated rather than hidden: a head between this cap and
// MAX_CONTEXT_CHARS now drops (and NAMES) a line it could physically have held,
// on a page that would otherwise have lost nothing. That band is 300 characters
// wide and only a head already an order of magnitude past anything real reaches
// it. It is the same trade the body has always made - NOTICE_RESERVE_CHARS is
// subtracted from `budgetForBody` on every call including the ones that drop
// nothing - applied one level up, and it buys the guarantee above.
const MAX_HEAD_CHARS = MAX_CONTEXT_CHARS - NOTICE_RESERVE_CHARS;

// The two list headings, named because their length is BUDGETED (as part of the
// head's fixed overhead) in one place and SPENT in another.
const CHILD_HEADING = "Sub-pages:\n";
const ATTACHMENT_HEADING = "Attachments:\n";

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

// One candidate line per child page, with the display name carried ALONGSIDE
// the line rather than parsed back out of it (the shape lib/meeting/
// meetingContext.js's formatPageBlock already uses for the same reason). The
// name is computed by the same rule the line uses (title, else
// UNTITLED_CHILD_PAGE) minus the per-field clip: the clip exists to stop one
// long title eating the inventory's share of the budget, and the names are
// budgeted separately (see the notice assembly in buildPageContext), while
// `droppedChildPages` is structured data for a caller to render rather than
// prose and should carry the real title.
//
// UNCAPPED, deliberately - both caps now live in capListLines below, so that
// the count cap and the character cap are applied in ONE pass and the dropped
// tail they produce is one set rather than two that could describe different
// items.
function childPageEntries(childPages) {
  return (Array.isArray(childPages) ? childPages : []).filter(Boolean).map((entry) => {
    const name = str(entry?.title).trim() || UNTITLED_CHILD_PAGE;
    return { line: `- ${clip(name, MAX_FIELD_CHARS)}`, name };
  });
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

// THE FILTER MOVED IN FRONT OF THE CAP, and that is a behaviour change made on
// purpose. This used to slice 60 raw rows and only then drop the ones
// formatAttachment refuses (its own guard returns "" for anything without a
// usable name, which the object-shape filter does not catch) - so `dropped`
// counted junk rows as "attachments not included", and 60 junk rows ahead of
// five real ones produced an EMPTY inventory with five real files reported as
// dropped.
//
// Naming them is what forced the question: a row with no name cannot be named
// honestly. Calling it "Untitled file" would mint exactly the phantom
// inventory line formatAttachment's guard exists to prevent, one sentence
// lower down; leaving it blank would print `“”`. The only honest answer is
// that a row which would never have been listed is not an attachment the
// budget left out. So the cap now applies to the attachments that really
// produce a line, which makes the count and the names describe one single set
// by construction, and makes "60" mean 60 listed files rather than 60 rows of
// which an unknown number vanish. Every line formatAttachment returns has a
// non-blank name (it returns "" otherwise), so the names below need no
// fallback at all.
function attachmentEntries(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({ line: formatAttachment(entry), name: str(entry.name).trim() }))
    .filter((entry) => entry.line !== "");
}

// THE CAP THAT WAS MISSING, and the defect it closes.
//
// MAX_LISTED_CHILD_PAGES / MAX_LISTED_ATTACHMENTS bound how MANY lines a list
// contributes. MAX_FIELD_CHARS bounds how long EACH line may be. Nothing bounded
// what a list COSTS - so sixty sub-pages of three hundred characters each was
// sixty lines, none of them over-long, and a head of ~18800 characters. The head
// is not cut internally by design, `budgetForBody` merely floored at zero, no
// list reached its count cap, so NO NOTICE WAS ASSEMBLED AT ALL - and the
// defensive clamp at the end of buildPageContext cut the overflow off the tail.
// Measured: content exactly 12000, `truncated: false`, no notice, twenty of the
// user's sub-pages destroyed. A silent truncation, committed by the module whose
// header says silent truncation "is the actual defect this module exists to
// prevent".
//
// The clamp could never have been the remedy: the notice lives in the TAIL, so
// clamping destroys the very sentence that would report the loss.
//
// BOTH CAPS IN ONE PASS, which is what makes the dropped tail a single set. This
// is lib/experience/knowledgeBase.js's capAttachmentLines - "by BOTH count and
// total characters, whichever binds first" - reused as a shape rather than
// imported, because that one caps a single list against a per-page constant
// while this one shares a budget between two lists. Both caps remain PREFIX
// cuts, so their union is still a prefix cut and `dropped` is still exactly the
// tail of the list that was already in hand.
function capListLines(entries, maxCount, budget) {
  const shown = [];
  let used = 0;
  for (const entry of entries) {
    if (shown.length >= maxCount) break;
    const addLen = entry.line.length + (shown.length > 0 ? LINE_JOIN.length : 0);
    if (used + addLen > budget) break;
    shown.push(entry);
    used += addLen;
  }
  return {
    text: shown.map((entry) => entry.line).join(LINE_JOIN),
    used,
    droppedNames: entries.slice(shown.length).map((entry) => entry.name),
  };
}

// What a list would cost if only its COUNT cap applied - the number capListLines
// would spend given unlimited budget. Used to decide the split between the two
// lists below, so a list that wants little is never handed half regardless.
function listCost(entries, maxCount) {
  return entries
    .slice(0, maxCount)
    .reduce((sum, entry, index) => sum + entry.line.length + (index > 0 ? LINE_JOIN.length : 0), 0);
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Wraps the clause list in the exact sentence this module has always emitted.
// Kept as one function so the SKELETON (the same clauses with no names) and
// the finished notice are measured through identical code - measuring them
// differently is how a reserve calculation silently goes stale.
function wrapNotice(clauses) {
  return `[Note: ${clauses.join("; ")} - content was shortened to fit the AI context budget.]`;
}

// Adds the names to each count clause, spending at most NOTICE_RESERVE_CHARS on
// the whole notice.
//
// THE RULE, stated once here and again in lib/experience/droppedNames.js: the
// reserve never moves, the names do. The reserve was carved out of the BODY's
// budget, so growing it would be paid for in the user's own page content on
// every call, including the ones that drop nothing at all - and the defensive
// clamp at the end of buildPageContext cuts from the tail, which is where this
// notice lives, so an unrationed name list would end up truncating the very
// sentence that reports the truncation.
//
// The counts are never what gets sacrificed: they are written first, into the
// skeleton, and whatever the reserve has left over is what the names get.
// Clauses take from that remainder IN ORDER, so a long sub-page list can leave
// the attachment list with nothing but its count - deterministic, and the
// count is the part the reader cannot do without.
function assembleNotice(entries) {
  // BLOCK_JOIN comes out FIRST, before the skeleton is even measured: the
  // reserve buys the notice AND the blank line that attaches it to whatever
  // precedes it, because `content` pays for both or for neither. See BLOCK_JOIN.
  let remaining =
    NOTICE_RESERVE_CHARS - BLOCK_JOIN.length - wrapNotice(entries.map((entry) => entry.text)).length;
  const clauses = entries.map((entry) => {
    if (entry.names.length === 0) return entry.text;
    const list = formatDroppedNames(entry.names, { budget: remaining - NAME_CLAUSE_JOIN.length });
    if (!list) return entry.text;
    remaining -= NAME_CLAUSE_JOIN.length + list.length;
    return `${entry.text}${NAME_CLAUSE_JOIN}${list}`;
  });
  return wrapNotice(clauses);
}

// buildPageContext({ page, breadcrumb, childPages, attachments }) ->
// { label, content, truncated, droppedChildPages, droppedAttachments }.
//
// `label` is what the chat opener names ("I need help with <label>: ") -
// always just the page title.
//
// `content` is the pinned-context body: title, breadcrumb, child-page
// titles, and the attachment inventory (the "head", bounded by MAX_LISTED_*
// AND by MAX_HEAD_CHARS, and never cut mid-line by either) followed by as
// much of the page body as the remaining budget allows, followed by a notice
// naming whatever was left out, if anything was.
//
// `truncated` is true the moment ANY of the body, the child-page list, or
// the attachment list had to drop something to fit - never inferred from
// content.length alone, so a caller can act on it directly.
//
// `droppedChildPages` / `droppedAttachments` are the DISPLAY NAMES of what
// each list left out, in the order they appear on the page, always arrays and
// never undefined so a caller can read `.length` without a guard. A child page
// with no title reports the same "Untitled page" the inventory line above it
// uses; an attachment with no usable name is neither counted nor named,
// because it would never have been listed at all (see formatAttachments).
//
// WHY THE NAMES ARE ALSO IN THE NOTICE, unlike lib/experience/tailorContext.js,
// which keeps its model-facing notice a count and hands the names to its route
// instead. There, a human reads the route's warning. Here there is no such
// second reader today: app/components/experience/ExperienceTab.js destructures
// `{ label, content }` and hands `content` to the chat, where ChatPanel renders
// only the `label` - so a name that is not in `content` is a name nobody, model
// or human, ever sees. The return values exist so that component can surface
// them properly (it is owned by another pass), and the notice carries them in
// the meantime, rationed inside NOTICE_RESERVE_CHARS by assembleNotice above so
// that carrying them can never cost the page any content.
export function buildPageContext(input) {
  const src = input && typeof input === "object" ? input : {};
  const page = src.page && typeof src.page === "object" ? src.page : {};
  const title = str(page.title).trim() || "Untitled page";
  const body = str(page.body);

  // CLIPPED, where they never used to be. These two were the only free-text
  // fields in this module MAX_FIELD_CHARS did not reach, so either one alone
  // could carry the head past the budget and take the whole inventory down with
  // it through the clamp - the same silent truncation capListLines describes,
  // through a different door. Clipping bounds the identity lines at ~1200
  // characters, which is what lets the list budget below be a real number rather
  // than a hope.
  //
  // NOT ALSO ON `label`, which is the full title: `label` is the caller's own
  // one-line opener, not part of this budget, and shortening it would change a
  // separate contract to fix this one. A clipped title loses its tail to a
  // VISIBLE "…" rather than to a silent slice, and it earns no notice clause
  // because a title IS its own name - there is nothing to name it by that the
  // reader is not already looking at. This is exactly what the module already
  // does to every attachment note and every child-page title.
  const headTitle = clip(title, MAX_FIELD_CHARS);
  const breadcrumbText = clip(formatBreadcrumb(src.breadcrumb), MAX_FIELD_CHARS);

  const childEntries = childPageEntries(src.childPages);
  const attachmentCandidates = attachmentEntries(src.attachments);

  const identityLines = [`Project: ${headTitle}`];
  if (breadcrumbText) identityLines.push(`Path: ${breadcrumbText}`);

  // The head's fixed overhead: the identity lines (highest priority of all -
  // "keeps the title and breadcrumb even when the body must be cut") plus each
  // list's own heading and the BLOCK_JOIN that attaches it. Charged whenever a
  // list has any CANDIDATE, which slightly over-reserves in the one case where
  // the budget then admits none of them - the head simply comes in a few
  // characters under its cap, which is the safe direction.
  const listOverhead =
    (childEntries.length > 0 ? BLOCK_JOIN.length + CHILD_HEADING.length : 0) +
    (attachmentCandidates.length > 0 ? BLOCK_JOIN.length + ATTACHMENT_HEADING.length : 0);
  const listBudget = Math.max(0, MAX_HEAD_CHARS - identityLines.join(BLOCK_JOIN).length - listOverhead);

  // NEITHER LIST MAY ANNIHILATE THE OTHER, which is the one decision here that
  // is not forced by arithmetic. Packing the head in render order (sub-pages,
  // then attachments) is simpler and would still be HONEST - everything dropped
  // is named - but it lets a long sub-page list spend the entire budget and
  // leave the attachment inventory empty, and this module's own header ranks
  // that inventory ABOVE the body, not below the sub-page list. So attachments
  // are costed first and guaranteed at least half; sub-pages get everything
  // attachments do not want, and attachments then get everything sub-pages did
  // not use. Neither list is ever handed less than its share, and neither is
  // ever handed a share it has no use for. Same reasoning MAX_FIELD_CHARS gives
  // one level down about one note crowding out every other attachment's line.
  const attachmentShare = Math.min(
    listCost(attachmentCandidates, MAX_LISTED_ATTACHMENTS),
    Math.floor(listBudget / 2),
  );
  const child = capListLines(childEntries, MAX_LISTED_CHILD_PAGES, listBudget - attachmentShare);
  const attachments = capListLines(attachmentCandidates, MAX_LISTED_ATTACHMENTS, listBudget - child.used);

  const droppedChildPages = child.droppedNames;
  const droppedAttachments = attachments.droppedNames;
  const childDropped = droppedChildPages.length;
  const attachmentDropped = droppedAttachments.length;

  const headLines = [...identityLines];
  if (child.text) headLines.push(`${CHILD_HEADING}${child.text}`);
  if (attachments.text) headLines.push(`${ATTACHMENT_HEADING}${attachments.text}`);
  const head = headLines.join(BLOCK_JOIN);

  // What's left for the body once the head (never cut, see above) and a
  // reserve for the notice (written last, only if actually needed) are both
  // accounted for, plus the body block's own two costs: the "Body:\n" label,
  // and the ONE BLOCK_JOIN that attaches this block to the head. The join to
  // the NOTICE is not subtracted here - it is charged to NOTICE_RESERVE_CHARS
  // inside assembleNotice instead, so a call that drops nothing (no notice, no
  // second join) still gets every character of this budget for the user's own
  // page. See BLOCK_JOIN for why each block pays for its own attachment, and
  // for the off-by-one this replaced.
  const budgetForBody = Math.max(
    0,
    MAX_CONTEXT_CHARS - head.length - NOTICE_RESERVE_CHARS - BLOCK_JOIN.length - "Body:\n".length,
  );

  const bodyTruncated = body.length > budgetForBody;
  const bodyText = bodyTruncated ? body.slice(0, budgetForBody) : body;

  // `names` is empty for the body clause because a truncated body is one
  // thing, not a list of them - the notice already names it ("the body").
  const notices = [];
  if (bodyTruncated) {
    notices.push({ text: "the body was truncated to fit the AI context budget", names: [] });
  }
  if (childDropped > 0) {
    notices.push({ text: `${pluralize(childDropped, "sub-page")} not included`, names: droppedChildPages });
  }
  if (attachmentDropped > 0) {
    notices.push({ text: `${pluralize(attachmentDropped, "attachment")} not included`, names: droppedAttachments });
  }

  const truncated = notices.length > 0;
  const noticeBlock = truncated ? assembleNotice(notices) : "";

  const bodyBlock = bodyText ? `Body:\n${bodyText}` : "";

  // BLOCK_JOIN, not a bare "\n\n" literal: this is the character cost that
  // budgetForBody and assembleNotice have each already subtracted once, and two
  // literals are how the spender and the budgeters drift apart again.
  let content = [head, bodyBlock, noticeBlock].filter(Boolean).join(BLOCK_JOIN);

  // Defensive final clamp: the budgeting above is designed to always hold,
  // but if some future change to the head/notice shapes ever overshoots it
  // anyway, the hard contract (content never exceeds MAX_CONTEXT_CHARS) must
  // still hold rather than silently breaking it.
  //
  // ITS OWN COMMENT USED TO BE FALSE, which is worth keeping on the record here
  // because it is what made the defect invisible. It promised a tail cut "can
  // only ever remove notice text, never the title/breadcrumb/attachment
  // inventory" - true only while the head fits, which nothing enforced. With an
  // unbounded head this line cut the inventory itself, mid-title, on a call that
  // had assembled no notice to remove and reported `truncated: false`.
  //
  // Now it is genuinely unreachable rather than merely intended to be: the head
  // is capped at MAX_CONTEXT_CHARS - NOTICE_RESERVE_CHARS, the body block is
  // budgeted out of what the head leaves, and the notice is rationed inside the
  // reserve that pays for its own join - so the three blocks and their two joins
  // sum to at most MAX_CONTEXT_CHARS by construction. Kept anyway, for the
  // reason it was written: a future change to any of those three shapes should
  // break the budget loudly in a test, not silently in a user's prompt.
  if (content.length > MAX_CONTEXT_CHARS) {
    content = content.slice(0, MAX_CONTEXT_CHARS);
  }

  return { label: title, content, truncated, droppedChildPages, droppedAttachments };
}
