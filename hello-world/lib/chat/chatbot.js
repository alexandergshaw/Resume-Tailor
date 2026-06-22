// Chatbot helpers and handler factory. All chat-related functions live here;
// the host component passes its state, setters, refs, and a few helper
// utilities into `createChatHandlers` and gets back closures bound to that
// snapshot.

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

  async function addChatAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setChatAttachError("");
    const accepted = [];
    for (const file of files) {
      if (!file) continue;
      if (file.size > 5 * 1024 * 1024) {
        setChatAttachError(`${file.name} is too large (max 5 MB).`);
        continue;
      }
      const lowerName = (file.name || "").toLowerCase();
      const type = file.type || "";
      const isImage = type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(lowerName);
      const isPdf = type === "application/pdf" || lowerName.endsWith(".pdf");
      try {
        if (isDocxResume(file)) {
          const lines = await buildTemplateLinesForUpload(file);
          const content = (lines || []).join("\n").trim();
          if (!content) { setChatAttachError(`${file.name}: no text could be extracted.`); continue; }
          accepted.push({ name: file.name, kind: "text", content });
        } else if (
          isTextResume(file) ||
          /\.(txt|md|csv|json|log)$/i.test(lowerName) ||
          (type && type.startsWith("text/"))
        ) {
          const content = (await file.text()).trim();
          if (!content) { setChatAttachError(`${file.name}: no text could be extracted.`); continue; }
          accepted.push({ name: file.name, kind: "text", content });
        } else if (isImage || isPdf) {
          const dataB64 = await readFileAsBase64(file);
          if (!dataB64) { setChatAttachError(`${file.name}: could not read file.`); continue; }
          const mimeType = type || (isPdf ? "application/pdf" : "image/png");
          accepted.push({
            name: file.name,
            kind: "binary",
            mimeType,
            dataB64,
            previewUrl: isImage ? URL.createObjectURL(file) : null,
          });
        } else {
          setChatAttachError(
            `${file.name}: unsupported type. Use text, .docx, images, or PDF.`,
          );
          continue;
        }
      } catch (err) {
        setChatAttachError(`${file.name}: ${err.message || "failed to read."}`);
      }
    }
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
    const userMsg = { role: "user", content: trimmed };
    const nextMessages = [...(baseMessages || []), userMsg];
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

      const applicationsContext = (applicationData || []).map((app) => {
        const pos = app.positions || {};
        const resume = app.generated_resumes;
        const stages = applicationStages[app.id] || [];
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
            interviewers: s.interviewer_names || [],
            notes: s.notes || null,
          })),
        };
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          resumeText,
          applications: applicationsContext,
          pinnedContext: chatPinnedContext
            ? { label: chatPinnedContext.label, content: chatPinnedContext.content }
            : null,
          attachedFiles: (chatAttachedFiles || []).map((f) =>
            f.kind === "binary"
              ? { name: f.name, mimeType: f.mimeType, dataB64: f.dataB64 }
              : { name: f.name, content: f.content },
          ),
          tab: mainTab,
          section: activeSection,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Chat request failed.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: payload.reply || "" }]);
    } catch (err) {
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
