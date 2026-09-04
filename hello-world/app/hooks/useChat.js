"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createChatHandlers } from "../../lib/chat/chatbot";
import {
  isDocxResume,
  isTextResume,
  buildTemplateLinesForUpload,
} from "../../lib/document/docx";

// The floating "AI Help" chat panel: message thread, pinned context,
// attachments, and a resizable/persisted panel size. Handler implementations
// live in lib/chat/chatbot (createChatHandlers); this hook owns the state, refs,
// and the panel's effects (size persistence, click-outside close, auto-scroll).
//
// --- The chatError announcement (A2 / AC-33, AC-34) -------------------------
//
// A2/AC-34's problem, unchanged: when `resumeFile` is null there is no `await`
// between `setChatError("")` (chatbot.js's pre-send reset) and
// `setChatError(msg)` (the catch on an identical repeat refusal), so React
// coalesces both into ONE commit whose value equals the value already on
// screen. Nothing about the region changes, and a screen-reader user who
// pressed Send or Resend a second time hears silence.
//
// WHY THIS IS NOT A `flushSync`, WHICH IS WHAT IT USED TO BE. The flushSync
// forced a second REACT COMMIT of "" -> msg, and the MutationObserver test in
// ChatPanel.gaps.test.js confirms it -- at the React/DOM layer, which is the
// layer where it works. It is the NEXT layer that decides whether anything is
// spoken, and there flushSync buys nothing: accessibility-tree serialization
// in Chromium is driven by the rendering lifecycle, which flushSync does not
// run; a text change is not one of the events that forces immediate
// processing; and serialization is DEFERRED (~150 ms) after the last one. The
// Send click itself forces a serialization and restarts that window, so the
// clear-and-set pair that follows is MORE likely to be coalesced, not less --
// and `msg -> "" -> msg` inside one serialization diffs to `msg -> msg`: no
// change, no event, no announcement. A test at the DOM layer cannot see that,
// which is exactly how the mechanism survived review.
//
// What replaces it does not depend on any of that timing: NODE IDENTITY. The
// live region is still always mounted (AC-33); the error TEXT is rendered
// inside it as an element keyed by this counter, so each announcement makes
// React destroy the old node and create a new one -- an unambiguous tree
// modification rather than a text diff that can come out empty. It is what
// @react-aria/live-announcer does (a fresh element per message into a
// persistent region), and it is materially different from the parity-nonce
// idea A2 rejected: the counter is a `key`, NEVER rendered text, so nothing
// leaks into what a screen reader speaks or the user copies (the U+200B
// defect at DriveResultRegion.js) and there is no parity to fall out of sync
// (AttachmentPanel.js's documented silent-failure shape).
//
// WHY A MODULE-SCOPE STORE RATHER THAN HOOK STATE. The counter has to reach
// ChatPanel, and in the coalesced case there is no state change to carry it:
// that is the whole defect. Hook state would have to travel as a new prop
// through app/page.js's explicit prop list -- and a prop that is missing
// there while present in a test harness that spreads the hook's return is the
// green-test/broken-product trap. A store subscribed to with
// `useSyncExternalStore` reaches the component that renders the region
// directly, and re-renders it on its own; single panel, single store, the
// same shape @react-aria/live-announcer uses.
const chatErrorAnnouncement = { seq: 0, listeners: new Set() };

function bumpChatErrorAnnouncement() {
  chatErrorAnnouncement.seq += 1;
  // Copy before iterating: a listener that unsubscribes during notification
  // must not mutate the set being walked.
  for (const listener of [...chatErrorAnnouncement.listeners]) {
    try {
      listener();
    } catch {
      /* noop -- one torn-down subscriber must not swallow the announcement */
    }
  }
}

function subscribeChatErrorAnnouncement(listener) {
  chatErrorAnnouncement.listeners.add(listener);
  return () => {
    chatErrorAnnouncement.listeners.delete(listener);
  };
}

function getChatErrorAnnouncementSeq() {
  return chatErrorAnnouncement.seq;
}

// Read by ChatPanel to key the error node. The server snapshot is the same
// getter: nothing bumps the counter during SSR, so it is 0 on both sides and
// hydration matches.
export function useChatErrorAnnouncementSeq() {
  return useSyncExternalStore(
    subscribeChatErrorAnnouncement,
    getChatErrorAnnouncementSeq,
    getChatErrorAnnouncementSeq,
  );
}

// Depends on the current resume + application data so the assistant can answer
// with the right context.
export function useChat({ resumeFile, applicationData, applicationStages, mainTab, activeSection }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  // AC-31g: the send/reply cue for ChatPanel's progress live region --
  // "" | "sending" | "ready". Set only from inside runChatRequest
  // (lib/chat/chatbot.js), which knows when a request actually reaches the
  // network versus refuses before `fetch`; no setter is returned below
  // because nothing outside that module has a reason to announce a send.
  const [chatProgress, setChatProgress] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatPinnedContext, setChatPinnedContext] = useState(null);
  const [chatAttachedFiles, setChatAttachedFiles] = useState([]);
  const [chatAttachError, setChatAttachError] = useState("");
  const [chatCopiedIndex, setChatCopiedIndex] = useState(null);
  const [chatDragActive, setChatDragActive] = useState(false);
  const [chatSize, setChatSize] = useState({ width: 380, height: 520 });
  const [chatResizing, setChatResizing] = useState(false);

  const chatPanelRef = useRef(null);
  const chatScrollRef = useRef(null);
  const chatInputRef = useRef(null);

  // Restore the saved panel size once on mount, then persist on change.
  useEffect(() => {
    try {
      const cs = localStorage.getItem("chatSize");
      if (cs) {
        const parsed = JSON.parse(cs);
        if (
          parsed && typeof parsed.width === "number" && typeof parsed.height === "number"
          && parsed.width >= 280 && parsed.height >= 320
        ) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setChatSize(parsed);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem("chatSize", JSON.stringify(chatSize));
  }, [chatSize]);

  // Close the chat when clicking outside its panel (but not on the FAB itself).
  useEffect(() => {
    if (!chatOpen) return;
    function handlePointerDown(e) {
      if (chatResizing) return;
      const panel = chatPanelRef.current;
      if (!panel) return;
      if (panel.contains(e.target)) return;
      // Don't close when the click is on the FAB — it has its own toggle.
      const fabEl = e.target.closest?.(".MuiFab-root");
      if (fabEl) return;
      setChatOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [chatOpen, chatResizing]);

  // Keep the message list scrolled to the latest message.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatSending, chatOpen]);

  // The seam every `setChatError` in chatbot.js goes through (it is passed in
  // as `setChatError` below), so an announcement is bumped wherever a chat
  // error is raised -- see the store above for the mechanism and for why it
  // is no longer a `flushSync`.
  //
  // The pre-send reset (`setChatError("")`) is NOT an announcement and must
  // not bump: it clears the region, and a new node carrying no text announces
  // nothing while burning a key.
  //
  // Text first, then the bump. Under React's batching the two land in one
  // commit either way; if they ever did not, this order re-keys the node
  // AFTER the new text is in it, rather than re-announcing the old one.
  //
  // No `try` is needed here any more. The `flushSync` this replaces rendered
  // the whole page tree synchronously from inside `runChatRequest`'s catch,
  // so a throw in any component escaped that catch, skipped the composer
  // restore in `sendChatMessage`, and surfaced as an unhandled rejection.
  // Both calls below are plain scheduled updates; the notification loop in
  // `bumpChatErrorAnnouncement` guards its own listeners.
  function announceChatError(text) {
    if (!text) {
      setChatError("");
      return;
    }
    setChatError(text);
    bumpChatErrorAnnouncement();
  }

  const { addChatAttachments, askAiAbout, sendChatMessage, resendUserMessage, startChatResize } =
    // createChatHandlers only stashes chatInputRef for use in its event handlers,
    // not during render.
    // eslint-disable-next-line react-hooks/refs
    createChatHandlers({
      chatInput,
      chatMessages,
      chatSending,
      chatPinnedContext,
      chatAttachedFiles,
      chatSize,
      setChatInput,
      setChatMessages,
      setChatSending,
      setChatError: announceChatError,
      setChatProgress,
      setChatOpen,
      setChatPinnedContext,
      setChatAttachedFiles,
      setChatAttachError,
      setChatSize,
      setChatResizing,
      chatInputRef,
      resumeFile,
      applicationData,
      applicationStages,
      mainTab,
      activeSection,
      isDocxResume,
      isTextResume,
      buildTemplateLinesForUpload,
    });

  return {
    // state
    chatOpen, setChatOpen,
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    chatSending,
    chatProgress,
    chatError, setChatError,
    chatPinnedContext, setChatPinnedContext,
    chatAttachedFiles, setChatAttachedFiles,
    chatAttachError, setChatAttachError,
    chatCopiedIndex, setChatCopiedIndex,
    chatDragActive, setChatDragActive,
    chatSize,
    chatResizing,
    // refs
    chatPanelRef, chatScrollRef, chatInputRef,
    // handlers
    addChatAttachments, askAiAbout, sendChatMessage, resendUserMessage, startChatResize,
  };
}
