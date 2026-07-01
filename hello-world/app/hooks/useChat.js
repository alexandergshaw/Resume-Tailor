"use client";

import { useEffect, useRef, useState } from "react";
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
// Depends on the current resume + application data so the assistant can answer
// with the right context.
export function useChat({ resumeFile, applicationData, applicationStages, mainTab, activeSection }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
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
      setChatError,
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
    chatError, setChatError,
    chatPinnedContext, setChatPinnedContext,
    chatAttachedFiles, setChatAttachedFiles,
    chatAttachError,
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
