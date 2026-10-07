"use client";

import { useEffect } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { useIsMobile } from "../hooks/useResponsive";
import { useChatErrorAnnouncementSeq } from "../hooks/useChat";
import { useEngine } from "../settings/engine";
import { useAnswerAsMe } from "../settings/answerAsMe";
import { useCopyFeedback } from "./preview/CopyFeedback";
import { useDocumentReview, ReviewControl, ReviewResultRegion } from "./preview/DocumentReviewSection";
import ChatAttachmentStrip from "./chat/ChatAttachmentStrip";
import ChatComposerDock from "./chat/ChatComposerDock";
import { revokeAttachmentPreview } from "../../lib/chat/chatbot";
import { requestSalaryEstimate } from "../../lib/chat/salaryEstimateRequest";
import { formatSalary } from "../../lib/feed/salary";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { MOBILE_TAP_MIN, TOUCH_FIELD_SX, TOUCH_ICON_SX, TOUCH_SWITCH_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

const ANSWER_AS_ME_NOTE_ID = "chat-answer-as-me-note";
// N123: with the voice preference ON the switch is described by this node. It is
// visually hidden (the accent on the label is the sighted cue), and it is never a
// live region -- the switch's own checked state is the announcement.
const VOICE_ON_NOTE_ID = "chat-answer-as-me-on-note";

// N123: attach, input and Send share one height -- 44px on phones, 40px above. A local
// pair rather than TOUCH_TARGET_SX, whose `sm` branch is "auto": the desktop height of
// these three is restyled here on purpose, not left as MUI's.
const COMPOSER_HEIGHT = { xs: MOBILE_TAP_MIN, sm: 40 };

// N123: the panel below the Context bar is a BODY (thread, then the review result and
// the attachment strip) and a DOCK (toolbar over composer). The body is the only part
// that gives up height -- `minHeight: 0` lets it shrink below its content -- and the
// dock after it never shrinks, so a review result or a pile of chips can no longer push
// the composer and Send out of the panel. Inside the body the thread keeps a floor and
// the result and strip shrink first.
const BODY_SX = {
  flex: "1 1 0",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  position: "relative",
};
const REVIEW_REGION_SX = {
  flex: "0 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  px: 1,
  pt: 0.75,
  borderTop: "1px solid var(--border)",
  backgroundColor: "var(--bg-surface)",
};
// Merged over the section's own chat result style so the result shrinks (and scrolls
// inside itself) before the dock or the thread floor does.
const REVIEW_RESULT_SX = { flex: "0 1 auto", minHeight: 0 };
// The drop hint is a label over the body, not a row: it adds nothing to the layout, so
// dragging a file in never moves the controls under the cursor, and it ignores pointer
// events so it is never the target of a spurious dragleave.
const DRAG_LABEL_SX = {
  position: "absolute",
  inset: 0,
  m: "auto",
  width: "fit-content",
  height: "fit-content",
  maxWidth: "calc(100% - 16px)",
  px: 2,
  py: 1,
  borderRadius: 2.5,
  textAlign: "center",
  pointerEvents: "none",
  zIndex: 1,
  backgroundColor: "var(--accent-soft)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontStyle: "italic",
};

const EMBEDDED_TOOLTIP =
  "Embedded engine: replies are generated on-device from your pinned posting, resume, and applications — no AI, works offline. Switch to Gemini in the top bar for open-ended chat.";

export default function ChatPanel({
  chatPanelRef,
  chatScrollRef,
  chatInputRef,
  chatDragActive,
  setChatDragActive,
  addChatAttachments,
  fabPos,
  chatSize,
  startChatResize,
  chatMessages,
  setChatMessages,
  chatError,
  setChatError,
  chatPinnedContext,
  setChatPinnedContext,
  // N103: the tailored document the pin points at (lib/review/selectReviewDocument.js),
  // or null when nothing reviewable is pinned.
  chatReviewDocument = null,
  chatSending,
  chatProgress,
  chatCopiedIndex,
  setChatCopiedIndex,
  resendUserMessage,
  chatAttachedFiles,
  setChatAttachedFiles,
  chatAttachError,
  setChatAttachError,
  chatInput,
  setChatInput,
  sendChatMessage,
  onClose,
  returnFocusRef,
}) {
  // On phones the resizable floating panel becomes a near-full-width bottom
  // sheet (and the pixel-drag resize handle is hidden) for usable chatting.
  const isMobile = useIsMobile();
  // Reflect the selected engine live: on "embedded" the chat is an offline,
  // no-AI assistant, so surface that plainly in the header and empty state.
  const { engine } = useEngine();
  const isEmbedded = engine === "embedded";
  // N102: the "answer as me" voice preference. Read from its own store (not a
  // prop) exactly as the engine is, so no caller has to thread it through.
  const { answerAsMe, setAnswerAsMe } = useAnswerAsMe();
  // AC-34: one number per announcement, used ONLY as a `key` on the error node
  // (never rendered). See app/hooks/useChat.js for the whole mechanism and for
  // why it is not a prop.
  const chatErrorSeq = useChatErrorAnnouncementSeq();
  // N103: a finished review is announced through the progress region below (a
  // short cue, never the findings). It clears itself after a moment, so a stale cue
  // can never come back later. N113: a review that could not run is NOT a polite cue
  // -- the user has to act (try again), so it goes to the assertive region beside the
  // progress one and persists, exactly as the preview modal announces it.
  const { announce: announceReview, regionProps: reviewCue } = useCopyFeedback("chat-review");
  const reviewCueText = reviewCue.polite;
  // N103: one review control for the pinned tailored document, never gated on the
  // engine (the review is key-free). N123 takes it in parts: the button sits in the
  // dock's toolbar and the result in the body above the dock (see BODY_SX).
  const review = useDocumentReview({ surface: "chat", request: chatReviewDocument, busy: chatSending, announce: announceReview });
  // N123: a result takes height from the thread while the thread keeps its scroll
  // offset, which can leave the latest turn below the fold. Re-anchor to the end when a
  // result appears or goes away.
  useEffect(() => {
    const thread = chatScrollRef?.current;
    thread?.scrollTo?.({ top: thread.scrollHeight });
  }, [review.hasResult, chatScrollRef]);
  // AC-31h: the Send button's own unavailable state, computed once and used
  // both for `aria-disabled` and for the visual affordance that replaces
  // MUI's `.Mui-disabled` now that the `disabled` attribute is gone (see the
  // button below).
  const sendUnavailable = chatSending || !chatInput.trim();
  // N102: ON only means something on an engine that can draft in the user's voice; the
  // switch is described by the embedded note there, and by the hidden ON note when ON.
  const voiceOn = answerAsMe && !isEmbedded;
  const voiceDescribedBy = isEmbedded ? ANSWER_AS_ME_NOTE_ID : voiceOn ? VOICE_ON_NOTE_ID : undefined;
  // AC-K1.4/AC-K1.6: closing the panel unmounts the control that was just
  // activated (the close button, or whichever element had focus when Escape
  // fired) -- without an explicit restore, focus falls to <body> and a
  // keyboard user loses their place in a ~200-stop page. `onClose` and
  // `returnFocusRef` both come from page.js, which hoists `setChatOpen`
  // and holds the ref to the AI Help launcher (ChatFab.js) that reopens it.
  const closeAndReturnFocus = () => {
    onClose?.();
    returnFocusRef?.current?.focus();
  };
  return (
    <Box
      ref={chatPanelRef}
      // AC-K1.5: Escape dismisses the panel from ANYWHERE inside it,
      // including the composer, which already owns Enter (below). A
      // `keydown` here catches the bubbled event from every descendant --
      // the composer's own handler only intercepts "Enter", so Escape is
      // never swallowed before it reaches this far. `stopPropagation` mirrors
      // DriveOverwriteDialog.js's Escape handler: nothing else in this app
      // currently listens for Escape at an ancestor of this fixed overlay,
      // but MUI Dialog/Menu/Popover own Escape at their own root the same
      // way, and this keeps the panel from ever double-firing into one.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        closeAndReturnFocus();
      }}
      onDragOver={(e) => { e.preventDefault(); setChatDragActive(true); }}
      onDragEnter={(e) => { e.preventDefault(); setChatDragActive(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setChatDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setChatDragActive(false);
        if (e.dataTransfer?.files?.length) {
          addChatAttachments(e.dataTransfer.files);
        }
      }}
      sx={{
        position: "fixed",
        // Sit just above the FAB (~64px tall) with a small gap.
        bottom: fabPos.bottom + 68,
        // Phones: span the viewport width (minus small gutters) as a bottom
        // sheet. Larger screens: floating panel anchored to the FAB, sized by
        // the user-draggable chatSize.
        ...(isMobile
          ? { left: 8, right: 8, width: "auto", maxWidth: "none", height: "min(70vh, 600px)" }
          : { right: fabPos.right, width: chatSize.width, height: chatSize.height, maxWidth: "calc(100vw - 16px)" }),
        maxHeight: "calc(100vh - 16px)",
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-surface)",
        border: chatDragActive ? "2px dashed var(--accent)" : "1px solid var(--border-strong)",
        borderRadius: 3,
        boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
        overflow: "hidden",
      }}
    >
      {/* Top-left corner resize handle (desktop only). */}
      {!isMobile && (
        <Box
          onPointerDown={startChatResize}
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            zIndex: 2,
            touchAction: "none",
            "&::before": {
              content: '""',
              position: "absolute",
              top: 3,
              left: 3,
              width: 10,
              height: 10,
              borderTop: "2px solid var(--border-strong)",
              borderLeft: "2px solid var(--border-strong)",
              borderTopLeftRadius: 3,
              opacity: 0.6,
            },
            "&:hover::before": { opacity: 1, borderColor: "var(--accent)" },
          }}
        />
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.25,
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--bg-soft)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          <Box sx={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>
            AI Help
          </Box>
          {isEmbedded ? (
            <Chip
              size="small"
              label="Offline · no AI"
              title={EMBEDDED_TOOLTIP}
              icon={
                <Box
                  component="span"
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: "var(--accent)",
                    ml: "6px !important",
                  }}
                />
              }
              sx={{
                height: 20,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.2,
                color: "var(--text-secondary)",
                backgroundColor: "var(--bg-soft)",
                border: "1px solid var(--border)",
                "& .MuiChip-label": { px: 0.75 },
              }}
            />
          ) : null}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          {chatMessages.length > 0 || chatAttachedFiles.length > 0 ? (
            <Button
              size="small"
              onClick={() => {
                setChatMessages([]);
                setChatError("");
                // The bulk-attach path (ExperienceTab.js) can leave chips in the
                // tray with zero messages sent -- Clear has to be the way out of
                // that unsendable payload too, not just a thread reset.
                // M6: revoke every discarded chip's preview blob URL before the
                // tray is emptied, or each one leaks for the page's life.
                chatAttachedFiles.forEach(revokeAttachmentPreview);
                setChatAttachedFiles([]);
                // M5: without this, a stale "...is too large..." refusal from a
                // bulk add keeps pointing at files Clear just removed.
                // Optional call: `setChatAttachError` is a prop, and some
                // callers (older tests, callers that never surface the refusal
                // banner) may not pass one.
                setChatAttachError?.("");
              }}
              sx={{ textTransform: "none", fontSize: "0.8rem", color: "var(--text-secondary)", ...TOUCH_TARGET_SX }}
            >
              Clear
            </Button>
          ) : null}
          {/* AC-K1.4: the panel's only close control before this fix was the
              AI Help launcher's own toggle (mouse/touch-only, see ChatFab.js)
              and useChat.js's outside-click listener -- neither reachable by
              keyboard. A real IconButton gets Enter/Space from the browser
              for free and `.MuiButtonBase-root` for the app-wide focus ring. */}
          <IconButton
            aria-label="Close"
            size="small"
            onClick={closeAndReturnFocus}
            sx={{ color: "var(--text-secondary)", ...TOUCH_ICON_SX }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {chatPinnedContext ? (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          {/* --accent-hover on the soft fill: 11px text, and --accent there is 4.36:1 in dark mode. */}
          <Box sx={{ fontSize: 11, fontWeight: 700, color: "var(--accent-hover)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Context
          </Box>
          <Box
            // The label is ellipsized to the bar's width; the title gives the rest on hover.
            title={chatPinnedContext.label}
            sx={{ flex: 1, fontSize: "0.85rem", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {chatPinnedContext.label}
          </Box>
          {/* N65/S1/S12: the pinned posting flows straight into the request --
              nobody re-picks or re-pastes it -- and the control is hidden
              outright when the posting already states its pay (the safe
              default: `posting` is only ever set by a caller that computed a
              real salaryStated, and every other pinned subject leaves it
              null). One click reaches the real route with no intermediate
              dialog. */}
          {chatPinnedContext.posting && !chatPinnedContext.posting.salaryStated ? (
            <Button
              size="small"
              disabled={chatSending}
              onClick={() =>
                requestSalaryEstimate({
                  posting: chatPinnedContext.posting,
                  engine,
                  setChatMessages,
                  setChatError,
                })
              }
              sx={{ minWidth: 0, px: 1, fontSize: 11, textTransform: "none", color: "var(--accent-hover)", whiteSpace: "nowrap", ...TOUCH_TARGET_SX }}
            >
              Estimate salary
            </Button>
          ) : null}
          <Button
            size="small"
            onClick={() => setChatPinnedContext(null)}
            sx={{ minWidth: { xs: MOBILE_TAP_MIN, sm: 0 }, p: 0.25, fontSize: 12, color: "var(--text-secondary)", ...TOUCH_TARGET_SX }}
            aria-label="Remove context"
          >
            ✕
          </Button>
        </Box>
      ) : null}

      <Box sx={BODY_SX}>
        <Box
          ref={chatScrollRef}
          sx={{
            // 48px is the floor the thread keeps while a result or the strip is open.
            flex: "1 1 0",
            minHeight: 48,
            overflowY: "auto",
            px: 1.5,
            py: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {/* AC-31g clause 4/5: `aria-busy` marks this turn list as mid-update
              while a send is in flight -- it is NOT an announcement (no screen
              reader speaks an `aria-busy` change; the progress region below is
              the announcement) and it must never wrap either live region, or it
              SUPPRESSES that region's announcements until it clears, silencing
              the refusal AC-31f rests on. `display: "contents"` keeps this Box
              out of the flex layout entirely -- its children stay direct flex
              items of the scroll container above, so the existing spacing is
              unchanged -- while still giving `aria-busy` a real element to live
              on and `closest()` a real ancestor to find (or not find). */}
          <Box aria-busy={chatSending} sx={{ display: "contents" }}>
            {chatMessages.length === 0 ? (
              <Box sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, px: 0.5, pt: 0.5 }}>
                {isEmbedded
                  ? "Offline assistant (no AI). I answer from your pinned posting, uploaded resume, and tracked applications — try “analyze this posting”, “review my resume”, or “my applications”. Switch to Gemini in the top bar for open-ended chat."
                  : "Ask anything about your resume, this posting, or your job search."}
              </Box>
            ) : (
              chatMessages.map((m, i) => (
              <Box
                key={i}
                // Only user turns are ever marked failed/sent -- an assistant
                // reply has nothing to retry, so it carries no attribute at
                // all. A `failed` turn must be reachable as its own element
                // (not folded into one outer wrapper) so the visible "not
                // sent" cue below stays scoped to just that turn.
                data-chat-turn={m.role === "user" ? (m.failed ? "failed" : "sent") : undefined}
                sx={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.25,
                }}
              >
                <Box
                  sx={{
                    px: 1.25,
                    py: 0.875,
                    borderRadius: 2.5,
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    backgroundColor: m.role === "user" ? "var(--accent)" : "var(--bg-soft)",
                    color: m.role === "user" ? "var(--bg-soft)" : "var(--text-primary)",
                    border: m.role === "user" ? "none" : "1px solid var(--border)",
                  }}
                >
                  {m.content}
                </Box>
                {/* N65/S3/S4/S5: rendered ONLY for a real estimate ("estimated"
                    status) -- a withhold/refuse/fail turn shows its
                    app-authored `content` above and nothing more (S3/S14: no
                    chip, no citations, so a degraded result never reads as a
                    confident negative). The chip is visibly and textually
                    labelled "Estimate", distinct from any stated-salary
                    render (FeedPostingCard never uses this word), and every
                    citation link is re-gated through safeExternalHref at
                    render time even though the builder already admitted it. */}
                {m.role === "assistant" && m.salaryEstimate && m.salaryEstimate.status === "estimated" ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, px: 0.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                      <Chip
                        size="small"
                        label={`Estimate · ${formatSalary(m.salaryEstimate.range.min, m.salaryEstimate.range.max)}`}
                        sx={{
                          height: 22,
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "var(--accent)",
                          backgroundColor: "var(--accent-soft)",
                          border: "1px solid var(--accent)",
                        }}
                      />
                    </Box>
                    <Box sx={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                      Based on {m.salaryEstimate.sourceCount} source{m.salaryEstimate.sourceCount === 1 ? "" : "s"} for{" "}
                      {m.salaryEstimate.basisKind === "company" ? "this company" : "similar roles in this market"}.
                    </Box>
                    {m.salaryEstimate.citations.length > 0 ? (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                        {m.salaryEstimate.citations.map((c, ci) => {
                          const safeHref = safeExternalHref(c.url);
                          if (!safeHref) return null;
                          return (
                            <Box
                              key={`${c.url}-${ci}`}
                              component="a"
                              href={safeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ fontSize: 11.5, color: "var(--accent)" }}
                            >
                              {c.title || c.host}
                            </Box>
                          );
                        })}
                      </Box>
                    ) : null}
                  </Box>
                ) : null}
                {m.role === "user" && m.failed ? (
                  // A `data-chat-turn="failed"` attribute alone is invisible --
                  // slot re-use on the next send would silently replace this
                  // message with no cue at all. This is the human-perceivable
                  // half of that requirement (Resend below is the escape hatch).
                  // m8: `role="status"` (implicitly `aria-live="polite"`) so a
                  // screen-reader user is told a send failed without having to
                  // discover the cue visually, and the font size matches
                  // `chatError` below (0.85rem) rather than sitting well under
                  // it -- this was the smallest text in the whole panel.
                  <Box role="status" sx={{ alignSelf: "flex-end", pr: 0.5, fontSize: "0.85rem", color: "var(--danger)" }}>
                    Not sent — try Resend below
                  </Box>
                ) : null}
                {m.role === "assistant" ? (
                  <Box sx={{ display: "flex", justifyContent: "flex-start", pl: 0.5 }}>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(m.content || "");
                          } else {
                            const ta = document.createElement("textarea");
                            ta.value = m.content || "";
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand("copy");
                            document.body.removeChild(ta);
                          }
                          setChatCopiedIndex(i);
                          setTimeout(() => {
                            setChatCopiedIndex((prev) => (prev === i ? null : prev));
                          }, 1500);
                        } catch {
                          /* noop */
                        }
                      }}
                      sx={{
                        minWidth: 0,
                        p: 0.25,
                        fontSize: 11,
                        textTransform: "none",
                        color: "var(--text-secondary)",
                        lineHeight: 1,
                      }}
                      title="Copy message"
                      aria-label="Copy message"
                    >
                      {chatCopiedIndex === i ? "✓ Copied" : "⧉ Copy"}
                    </Button>
                  </Box>
                ) : null}
                {m.role === "user" ? (
                  <Box sx={{ display: "flex", justifyContent: "flex-end", pr: 0.5 }}>
                    <Button
                      size="small"
                      disabled={chatSending}
                      onClick={() => resendUserMessage(i)}
                      sx={{
                        minWidth: 0,
                        p: 0.25,
                        fontSize: 11,
                        textTransform: "none",
                        color: "var(--text-secondary)",
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                      title="Resend this message"
                      aria-label="Resend this message"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      Resend
                    </Button>
                  </Box>
                ) : null}
              </Box>
            ))
            )}
            {chatSending ? (
              <Box
                sx={{
                  alignSelf: "flex-start",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  fontStyle: "italic",
                  px: 0.5,
                }}
              >
                Thinking…
              </Box>
            ) : null}
          </Box>
          {/* AC-31g: a SECOND always-mounted polite region, distinct from
              AC-33's below (never nested inside the aria-busy Box above --
              AC-31g clause 5 forbids it) and hooked by `data-chat-status` so a
              selector cannot silently re-point itself the day a third notice is
              added. Carries a SHORT CUE ONLY -- "Sending…" / "Reply ready" --
              never the reply text: `role="status"` is implicitly
              `aria-atomic="true"`, so a live region is re-read WHOLE on every
              change, and the reply is often hundreds of words. The cue node is
              keyed by state (AC-34's mechanism, restated here) so a transition
              is a tree modification, not a text diff VoiceOver can miss. Empty
              on mount, and empty again on any refusal or failure (set from
              lib/chat/chatbot.js's runChatRequest, which is the only thing that
              knows whether a send actually reached the network) -- the refusal
              belongs to the chatError region alone (AC-31f); two polite regions
              changing in one commit have unspecified announcement order across
              AT, and the refusal must not be the one that loses that race.
              Visually hidden: this cue has no sighted-user surface of its own,
              same technique as ExperienceTab.js's HIDDEN_STATUS_SX. */}
          <Box
            role="status"
            aria-live="polite"
            data-chat-status="progress"
            sx={{
              position: "absolute",
              width: "1px",
              height: "1px",
              padding: 0,
              margin: "-1px",
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            {chatProgress === "sending" ? (
              <span key="sending">Sending…</span>
            ) : chatProgress === "ready" ? (
              <span key="ready">Reply ready</span>
            ) : reviewCueText ? (
              <span key={`review-${reviewCue.seq}`}>{reviewCueText}</span>
            ) : null}
          </Box>
          {/* N113: the assertive counterpart, for a review that could not run. A
              sibling of the progress region (never inside the aria-busy turn list
              above, which would silence it), always mounted so the first failure is
              read, and empty until one happens. `role="alert"` is implicitly assertive
              and atomic; the cue is a short fixed sentence, never the findings. The
              node carrying the text is keyed by the announcement counter so a second
              identical failure is still a tree modification inside the region. */}
          <Box role="alert" data-chat-status="review-alert" sx={visuallyHidden}>
            {reviewCue.alert ? <span key={`review-alert-${reviewCue.seq}`}>{reviewCue.alert}</span> : null}
          </Box>
          {/* AC-33: unconditionally mounted (never `chatError ? … : null`) so
              the region exists in the accessibility tree BEFORE the first
              error ever appears -- assistive tech that starts observing only
              once mounted would otherwise miss the very first announcement.
              role="status" + aria-live="polite" mirror the failed-turn cue's
              own `<Box role="status">` (in the `m.role === "user" && m.failed`
              branch above), which must stay first in DOM order (verified: the
              turn map ends above this point). Never display:none /
              visibility:hidden here even when chatError is empty -- both pull
              the node out of the accessibility tree and would silence every
              future announcement, defeating the point of keeping it mounted.
              `sx` is verbatim from the conditional Box this replaces: A2 adds
              no new notice style (UX.md §8). Also never nested inside the
              aria-busy Box above -- AC-31g clause 5 forbids it, and this is the
              region AC-31f rests the entire non-sighted refusal experience on.

              AC-34: the REGION is permanent; the node carrying the text is not.
              Keying it by the announcement counter makes React destroy and
              recreate that node on every announcement, so a second, byte-
              identical refusal is still a tree modification inside a live
              region rather than a text diff that comes out empty. This is what
              @react-aria/live-announcer does. The counter is a `key` only --
              it is never rendered, so nothing reaches the speech stream or the
              clipboard that the user did not cause. */}
          <Box role="status" aria-live="polite" sx={{ alignSelf: "flex-start", color: "var(--danger)", fontSize: "0.85rem", px: 0.5 }}>
            {chatError ? <span key={chatErrorSeq}>{chatError}</span> : null}
          </Box>
        </Box>

        {/* N103: the review result. It does not read, clear or send the composer text.
            N123: it sits in the body above the dock and shrinks first, so a long result
            scrolls inside itself instead of pushing the composer out of the panel. */}
        {review.hasResult ? (
          <Box sx={REVIEW_REGION_SX}>
            <ReviewResultRegion hook={review} surface="chat" resultSx={REVIEW_RESULT_SX} />
          </Box>
        ) : null}
        <ChatAttachmentStrip files={chatAttachedFiles} setFiles={setChatAttachedFiles} attachError={chatAttachError} />
        {chatDragActive ? <Box sx={DRAG_LABEL_SX}>Drop files to attach as context…</Box> : null}
      </Box>
      {/* N123: the dock never shrinks (see BODY_SX). Two rows: the toolbar (review at
          the left, the voice switch at the right, the embedded note under it) over
          the composer (attach, input, Send). Chips and the review result are NOT in
          it -- they grow upward from it, so what the user just used does not move.
          The switch is built here, not in the dock: this is the one place that knows
          the engine and the voice preference. */}
      <ChatComposerDock
        toolbarStart={
          // The Review control keeps its landmark; with nothing pinned the slot holds
          // the short nothing-to-review line instead of a button.
          <Box
            component="section"
            aria-label={review.landmarkLabel}
            sx={{ display: "flex", alignItems: "center", minWidth: 0, flex: review.request ? "0 0 auto" : "1 1 0" }}
          >
            <ReviewControl hook={review} compact />
          </Box>
        }
        toolbarEnd={
          <>
            {/* N102: one switch, named by its own visible label (never a Tooltip,
                which would steal the name). The embedded engine cannot draft in
                the user's voice, so there it is disabled and its ON accent is
                suppressed even when a stale ON value is stored -- generic
                coaching prose must never read as the user's own draft. The
                switch's own checked state is the announcement: no live region. */}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={voiceOn}
                  disabled={isEmbedded}
                  onChange={(e) => setAnswerAsMe(e.target.checked)}
                  sx={TOUCH_SWITCH_SX}
                  slotProps={{ input: voiceDescribedBy ? { "aria-describedby": voiceDescribedBy } : undefined }}
                />
              }
              label={
                <Box sx={{ fontSize: 12, color: voiceOn ? "var(--accent)" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  Answer as me
                </Box>
              }
              sx={{ m: 0, flexShrink: 0, ...TOUCH_TARGET_SX }}
            />
            {voiceOn ? (
              <Box id={VOICE_ON_NOTE_ID} sx={visuallyHidden}>
                Replies are written in your voice.
              </Box>
            ) : null}
          </>
        }
        toolbarNote={
          isEmbedded ? (
            // --text-secondary, not --text-muted: this is 11px text, and muted is 4.15:1 on the surface.
            <Box id={ANSWER_AS_ME_NOTE_ID} sx={{ fontSize: 11, color: "var(--text-secondary)" }}>
              Answer as me applies to the AI engine. Switch to Gemini in the top bar.
            </Box>
          ) : null
        }
      >
        <Button
          component="label"
          size="small"
          variant="outlined"
          aria-label="Attach files for context"
          title="Attach files for context (or drop them anywhere in this panel)"
          sx={{
            textTransform: "none",
            flexShrink: 0,
            px: 0,
            minWidth: COMPOSER_HEIGHT,
            width: COMPOSER_HEIGHT,
            minHeight: COMPOSER_HEIGHT,
          }}
        >
          <AttachFileIcon fontSize="small" />
          <input
            type="file"
            hidden
            multiple
            accept="image/*,.pdf,application/pdf,.docx,.txt,.md,.csv,.json,.log,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
            onChange={(e) => {
              addChatAttachments(e.target.files);
              e.target.value = "";
            }}
          />
        </Button>
        <TextField
          size="small"
          multiline
          maxRows={4}
          // The offline state is already in the header chip, and the drop hint lives
          // on the attach control and the drag label, so the placeholder stays one
          // short line (a long one wraps and makes the empty composer taller).
          placeholder={isEmbedded ? "Message the assistant…" : "Message AI Help…"}
          sx={{ flex: "1 1 0", minWidth: 0, ...TOUCH_FIELD_SX }}
          value={chatInput}
          inputRef={chatInputRef}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChatMessage();
            }
          }}
          // AC-31 rev 6: the composer is deliberately NOT disabled while
          // `chatSending` is true. Disabling it is what drops focus to
          // <body> mid-send on a real browser (a disabled element cannot
          // hold focus), which is what let the 80 ms restore in
          // runChatRequest's `finally` cut off a screen reader's refusal
          // announcement. `chatSending` itself, the double-send guard on
          // the Send button below, and the "Thinking…" indicator are
          // unaffected -- only this input stops consuming the flag.
        />
        {/* AC-31h: the SEND button is the second control the "never
            disable" rule has to cover -- rev 6 only covered the composer.
            A browser blurs a focused control the moment it becomes
            `disabled`, dropping the keyboard user who just activated Send
            to <body>, and `runChatRequest`'s `finally` restores focus only
            `if (!refusedBeforeSend)` -- so on the refused path nobody
            brings them back. Deleting just `chatSending` from the old
            expression does NOT fix this: `sendChatMessage` clears
            `chatInput` on entry, so `!chatInput.trim()` alone keeps the
            button disabled for the whole flight -- the `disabled`
            ATTRIBUTE has to go entirely. `aria-disabled` replaces it, and
            is not redundant with nothing: the double-send guard already
            lives in JS (`sendChatMessage`'s `if (!text || chatSending)
            return`, `resendUserMessage`'s own guard), so the attribute was
            only ever a correctness no-op that cost the control its
            focusability. */}
        <Button
          variant="contained"
          onClick={sendChatMessage}
          aria-disabled={sendUnavailable}
          sx={{
            textTransform: "none",
            minWidth: 0,
            flexShrink: 0,
            px: 1.5,
            minHeight: COMPOSER_HEIGHT,
            // Dropping `disabled` also drops MUI's `.Mui-disabled`
            // styling, so the sighted cue has to come from somewhere else --
            // same dimmed, inert-looking affordance, without touching
            // focusability or the tab stop.
            ...(sendUnavailable ? { opacity: 0.5, pointerEvents: "none" } : null),
          }}
        >
          Send
        </Button>
      </ChatComposerDock>
    </Box>
  );
}
