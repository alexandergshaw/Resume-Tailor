"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import TextField from "@mui/material/TextField";
import { useIsMobile } from "../hooks/useResponsive";
import { useChatErrorAnnouncementSeq } from "../hooks/useChat";
import { useEngine } from "../settings/engine";
import { revokeAttachmentPreview } from "../../lib/chat/chatbot";

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
}) {
  // On phones the resizable floating panel becomes a near-full-width bottom
  // sheet (and the pixel-drag resize handle is hidden) for usable chatting.
  const isMobile = useIsMobile();
  // Reflect the selected engine live: on "embedded" the chat is an offline,
  // no-AI assistant, so surface that plainly in the header and empty state.
  const { engine } = useEngine();
  const isEmbedded = engine === "embedded";
  // AC-34: one number per announcement, used ONLY as a `key` on the error node
  // (never rendered). See app/hooks/useChat.js for the whole mechanism and for
  // why it is not a prop.
  const chatErrorSeq = useChatErrorAnnouncementSeq();
  // AC-31h: the Send button's own unavailable state, computed once and used
  // both for `aria-disabled` and for the visual affordance that replaces
  // MUI's `.Mui-disabled` now that the `disabled` attribute is gone (see the
  // button below).
  const sendUnavailable = chatSending || !chatInput.trim();
  return (
    <Box
      ref={chatPanelRef}
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
            sx={{ textTransform: "none", fontSize: "0.8rem", color: "var(--text-secondary)" }}
          >
            Clear
          </Button>
        ) : null}
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
          <Box sx={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Context
          </Box>
          <Box sx={{ flex: 1, fontSize: "0.85rem", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {chatPinnedContext.label}
          </Box>
          <Button
            size="small"
            onClick={() => setChatPinnedContext(null)}
            sx={{ minWidth: 0, p: 0.25, fontSize: 12, color: "var(--text-secondary)" }}
            aria-label="Remove context"
          >
            ✕
          </Button>
        </Box>
      ) : null}

      <Box
        ref={chatScrollRef}
        sx={{
          flex: 1,
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
          ) : null}
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

      <Box
        sx={{
          borderTop: "1px solid var(--border)",
          p: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
          backgroundColor: "var(--bg-surface)",
        }}
      >
        {chatAttachedFiles.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {chatAttachedFiles.map((f, i) => {
              // AC-27b: the refusal names this control as the remedy, so it
              // has to be OPERABLE, not just present. Shipped as a bare
              // `onDelete`, MUI binds only `isDeleteKeyboardEvent`
              // (Backspace/Delete) to it -- Enter and Space, ButtonBase's own
              // keys, have no `onClick` to call, so they do nothing, and the
              // real ✕ (`MuiChip-deleteIcon`) is `aria-hidden` with no name
              // and no tab stop of its own: mouse-only. `onClick` running the
              // SAME removal makes ButtonBase's Enter/Space path fire it too,
              // and `aria-label` gives the root a name that says what
              // activating it does (SC 4.1.2) while still containing the
              // visible label, the file name (SC 2.5.3). Backspace/Delete via
              // `onDelete` stay wired -- this ADDS keys, it does not swap
              // them. Deliberately NOT a real `<button>` inside `deleteIcon`:
              // the chip root is already a ButtonBase, and a button nested in
              // a button is invalid markup no AT handles predictably.
              const removeThisAttachment = () => {
                // M6: revoke this chip's own preview blob URL before it's
                // dropped from the tray.
                revokeAttachmentPreview(f);
                setChatAttachedFiles((prev) => prev.filter((_, idx) => idx !== i));
              };
              return (
                <Chip
                  key={`${f.name}-${i}`}
                  size="small"
                  label={f.name}
                  avatar={f.previewUrl ? <Avatar src={f.previewUrl} alt="" variant="rounded" /> : undefined}
                  onDelete={removeThisAttachment}
                  onClick={removeThisAttachment}
                  aria-label={`Remove ${f.name}`}
                  sx={{ maxWidth: 220 }}
                />
              );
            })}
          </Box>
        ) : null}
        {chatAttachError ? (
          <Box sx={{ fontSize: 12, color: "var(--danger)" }}>
            {chatAttachError}
          </Box>
        ) : null}
        {chatDragActive ? (
          <Box sx={{ fontSize: 12, color: "var(--accent)", fontStyle: "italic" }}>
            Drop files to attach as context…
          </Box>
        ) : null}
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-end" }}>
          <Button
            component="label"
            size="small"
            variant="outlined"
            sx={{ textTransform: "none", minWidth: 0, px: 1, fontSize: 12 }}
            title="Attach files for context"
          >
            + File
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
            fullWidth
            size="small"
            multiline
            maxRows={4}
            placeholder={
              isEmbedded
                ? "Message the offline assistant… (drop files anywhere here)"
                : "Message AI Help… (drop files anywhere here)"
            }
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
              px: 2,
              // Dropping `disabled` also drops MUI's `.Mui-disabled`
              // styling, so the sighted cue has to come from somewhere else --
              // same dimmed, inert-looking affordance, without touching
              // focusability or the tab stop.
              ...(sendUnavailable ? { opacity: 0.5, pointerEvents: "none" } : null),
            }}
          >
            Send
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
