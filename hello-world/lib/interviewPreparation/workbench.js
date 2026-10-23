import { candidateSourceText, contextStrength } from "./candidateContext";
import { critiqueAnswerLocal } from "@/lib/copilot/critiqueLocal";

export const STAGES = [
  ["brief", "1. Interview brief"], ["role", "2. Role and evidence"],
  ["company", "3. Company research"], ["interviewer", "4. Interviewer focus"],
  ["candidacy", "5. Your candidacy"], ["examples", "6. Reusable examples"],
  ["practical", "7. Common and practical questions"], ["questions", "8. Questions to ask"],
  ["mock", "9. Timed mock interview"], ["repair", "10. Improve weak answers"],
  ["reference", "11. Call reference and environment"], ["followup", "12. After the call"],
].map(([id, label]) => ({ id, label }));

export function createInputs() {
  return {
    jobTitle: "", company: "", description: "", resume: "", background: "", coverLetter: "",
    interviewer: "", interviewerTitle: "", audience: "recruiter", biography: "",
    dateTime: "", timezone: "", duration: "25", format: "Phone screen", connection: "", employerMaterials: "",
    product: "", buyer: "", user: "", beneficiary: "", businessModel: "", differentiation: "", priorities: "", culture: "",
    companyInterpretation: "", companyUnknowns: "", interestReasons: "", roleMotivation: "", transition: "",
    compensation: "", startDate: "", location: "", travel: "", schedule: "", authorization: "", otherProcesses: "",
    facts: [{ text: "", title: "", url: "", publishedAt: "", eventAt: "", confirmed: false }],
    examples: [{ title: "", context: "", responsibility: "", decision: "", action: "", result: "", learning: "", verified: false }],
    emphasized: "", learned: "", concerns: "", promises: "", nextStep: "", nextTiming: "", improveNext: "",
    environment: "", 
  };
}
const clean = (value) => typeof value === "string" ? value.trim() : "";
const lines = (value) => clean(value).split(/\n+/).map(clean).filter(Boolean);
const sentences = (value) => clean(value).split(/\n+|(?<=[.!?;])\s+/).map(clean).filter(Boolean);
const STOP = new Set("the and for with from this that your you our have has were was are will work role their them they into about what how would should can could personally relevant experience demonstrate prepare company team teams using own lead report including required responsibilities qualifications ability through across support".split(" "));
function tokens(value) {
  return [...new Set((clean(value).toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) || [])
    .map((v) => /^(postgres|postgresql|sql)$/.test(v) ? "sql" : v.replace(/(ing|ed|es|s)$/, "").replace(/([a-z])\1$/, "$1"))
    .filter((v) => v.length > 2 && !STOP.has(v)))];
}
function shared(a, b) { const bs = new Set(tokens(b)); return tokens(a).filter((v) => bs.has(v)).length; }
function distinctRequirements(description) {
  const requirements = [];
  const weight = (text) => (/\b(required|must|essential|minimum|mandatory|critical)\b/i.test(text) ? 5 : 0)
    + (/\b(responsib(?:le|ility|ilities)|own|lead|deliver|ensure)\b/i.test(text) ? 2 : 0)
    - (/\b(optional|nice.to.have|preferred|bonus)\b/i.test(text) ? 2 : 0);
  for (const text of sentences(description)) {
    const key = tokens(text);
    if (!key.length) continue;
    const duplicate = requirements.find((previous) => shared(text, previous.excerpt) / Math.max(1, Math.min(key.length, tokens(previous.excerpt).length)) >= 0.6);
    if (duplicate) {
      duplicate.frequency += 1;
      if (weight(text) > duplicate.weight) { duplicate.excerpt = text; duplicate.weight = weight(text); }
    } else requirements.push({ excerpt: text, frequency: 1, weight: weight(text), order: requirements.length });
  }
  return requirements.sort((a, b) => (b.weight + (b.frequency - 1) * 2) - (a.weight + (a.frequency - 1) * 2) || a.order - b.order)
    .slice(0, 6).map((entry) => entry.excerpt);
}
function roleThemes(inputs) {
  const evidence = sentences(inputs.resume || inputs.background);
  return distinctRequirements(inputs.description).map((excerpt, index) => {
    const matches = evidence.map((text) => ({ text, overlap: shared(excerpt, text) }))
      .filter((entry) => entry.overlap >= Math.min(2, tokens(excerpt).length))
      .sort((a, b) => b.overlap - a.overlap);
    return { id: `theme-${index}`, excerpt, evidence: matches[0]?.text || "", prompt: `What did you personally do to demonstrate: ${excerpt}` };
  });
}
function basisOf(inputs, sources) {
  const text = JSON.stringify({ inputs, sources });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `v1:${text.length}:${(hash >>> 0).toString(16)}`;
}
function availableFacts(inputs, sources) {
  const supplied = (inputs.facts || []).filter((fact) => clean(fact.text)).map((fact) => ({
    text: clean(fact.text), title: clean(fact.title) || "User-supplied source", url: clean(fact.url),
    publishedAt: clean(fact.publishedAt), eventAt: clean(fact.eventAt),
    attribution: fact.confirmed ? "Confirmed by you" : "User-supplied material — verify", 
  }));
  const research = (sources.articles || []).map((article) => ({
    text: clean(article.summary), title: clean(article.title), url: clean(article.url),
    publishedAt: clean(article.date || article.publishedAt), eventAt: "", attribution: "Research summary — verify against source",
  })).filter((fact) => fact.text);
  return [...supplied, ...research].slice(0, 3);
}
function questionList(inputs, sources, themes) {
  const facts = availableFacts(inputs, sources);
  const audience = inputs.audience === "recruiter"
    ? ["What are the next stages and expected timing?", "Which employment arrangements should I understand before continuing?"]
    : ["What decisions will I own, and how will success be evaluated?", "What are the biggest technical or team challenges in the first six months?"];
  const specific = facts[0] ? [{ text: `Your source describes “${facts[0].text}”. How, if at all, does this role contribute?`, source: facts[0].url, researched: true }] : [];
  const unknowns = lines(inputs.companyUnknowns || inputs.concerns).slice(0, 2).map((text) => ({ text: `Could you clarify: ${text}?`, researched: false }));
  const role = themes[0] ? [{ text: `What outcome matters most for ${themes[0].excerpt.replace(/[.!?;]+$/, "")} ?`, researched: false }] : [];
  return [...specific, ...unknowns, ...audience.map((text) => ({ text, researched: false })), ...role]
    .slice(0, 5).map((question, index) => ({ ...question, id: `question-${index}`, rank: index + 1 }));
}
function draftOf(artifacts, stage) { return clean(artifacts[stage]?.draft); }
function missingFields(inputs, pairs) { return pairs.filter(([key]) => !clean(inputs[key])).map(([, label]) => label); }

export function buildTool(stage, inputs, sources = {}, artifacts = {}, context = null) {
  const linkedInputs = context ? { ...inputs, resume: candidateSourceText(context), background: "" } : inputs;
  const themes = roleThemes(linkedInputs);
  const facts = availableFacts(inputs, sources);
  const reasons = lines(inputs.interestReasons).slice(0, 2);
  const output = { title: STAGES.find((entry) => entry.id === stage)?.label || stage, text: "", missing: [], basis: basisOf(inputs, stage === "reference" ? { ...sources, acceptedDrafts: Object.fromEntries(["brief", "candidacy", "examples", "practical", "questions"].map((id) => [id, draftOf(artifacts, id)])) } : sources) };
  switch (stage) {
    case "brief": {
      const pairs = [["interviewer", "Interviewer name"], ["dateTime", "Date and time"], ["timezone", "Time zone"], ["connection", "Connection instructions"]];
      output.missing = missingFields(inputs, pairs);
      const dateValid = !!clean(inputs.dateTime) && Number.isFinite(Date.parse(inputs.dateTime));
      if (inputs.dateTime && !dateValid) output.missing.push("Valid interview date and time");
      const minutes = Number(inputs.duration);
      const duration = Number.isFinite(minutes) && minutes > 0 && minutes <= 240 ? String(minutes) : "unknown — confirm";
      output.text = [`${inputs.jobTitle || "Role unknown"} — ${inputs.company || "Company unknown"}`,
        `Meeting: ${inputs.interviewer || "Name unknown"}${inputs.interviewerTitle ? `, ${inputs.interviewerTitle}` : ""} (${inputs.audience})`,
        `When: ${dateValid ? inputs.dateTime : "Date/time unknown — confirm"}; time zone: ${inputs.timezone || "unknown — confirm"}; ${duration} minutes`,
        `Format: ${inputs.format || "unknown"}. Connection: ${inputs.connection || "unknown — confirm"}`,
        `Likely focus (suggested): ${inputs.audience === "recruiter" ? "motivation, relevant background, process and practical arrangements" : "role priorities, personal decisions, technical depth and team outcomes"}`,
        `Employer materials: ${inputs.employerMaterials || "None supplied — review the invitation"}`].join("\n\n");
      break;
    }
    case "role":
      output.themes = themes;
      output.missing = !themes.length ? ["Add the job description"] : themes.length < 4 ? ["Short posting: fewer than four distinct themes found"] : [];
      output.text = themes.map((theme, index) => `${index + 1}. Posting: “${theme.excerpt}”\nDemonstrate: ${theme.prompt}\nResume evidence: ${theme.evidence ? `“${theme.evidence}”` : "Evidence needed — no sufficient matching excerpt"}`).join("\n\n");
      break;
    case "company": {
      output.facts = facts;
      const distinctions = [["product", "Products / problem solved"], ["buyer", "Buyer or funder"], ["user", "User"], ["beneficiary", "Beneficiary"], ["businessModel", "Operating model"], ["differentiation", "Distinctive approach"], ["priorities", "Priorities"], ["culture", "Working environment"]];
      output.missing = [...(!facts.length ? ["Add sourced facts or run company research"] : []), ...(reasons.length < 2 ? ["Add two personal reasons for your interest"] : [])];
      output.text = [distinctions.map(([key, label]) => `${label}: ${inputs[key] || "Unknown — investigate"}`).join("\n"),
        "Source material (not independently verified by this tool):", ...facts.map((fact) => `${fact.attribution}: ${fact.text}\n${fact.title}; ${fact.url || "source URL not supplied"}; publication: ${fact.publishedAt || "unknown"}; event: ${fact.eventAt || "unknown"}`),
        `Your reasons: ${reasons.join("; ") || "Not supplied"}`, `Interpretation (unconfirmed): ${inputs.companyInterpretation || "No interpretation supplied"}`,
        `Possible experience connections: ${themes.filter((v) => v.evidence).slice(0, 2).map((v) => `${v.excerpt} → ${v.evidence}`).join("; ") || "Add job and resume evidence"}`,
        `Open questions: ${inputs.companyUnknowns || "Confirm the business model, role priorities and working environment."}`].join("\n\n");
      break;
    }
    case "interviewer":
      output.missing = missingFields(inputs, [["interviewer", "Interviewer name"], ["biography", "Professional biography / notes"]]);
      output.text = [`Audience: ${inputs.interviewer || "Unknown"}; ${inputs.interviewerTitle || "Title unknown"}`,
        `Supplied professional background: ${inputs.biography || "Unknown — add an employer bio or your professional notes"}`,
        `Suggested focus: ${inputs.audience === "recruiter" ? "Recruiter: process, candidate logistics, motivation and employment arrangements." : `Hiring manager / specialist: personal decisions, technical responsibilities and team expectations. ${themes.slice(0, 2).map((v) => v.excerpt).join("; ")}`}`,
        ...questionList(inputs, {}, themes).slice(0, 3).map((v) => v.text), "No biography was fetched or independently verified."].join("\n\n");
      break;
    case "candidacy": {
      const background = clean(inputs.background) || sentences(inputs.resume).slice(0, 2).join(" ");
      output.missing = [...(!background ? ["Add your relevant background or resume"] : []), ...(!reasons.length ? ["Add your own interest reasons"] : []), ...(!clean(inputs.roleMotivation) ? ["Add why this role / why now"] : [])];
      output.text = [`Suggested framing — review before using; supplied facts stay yours.`,
        `Introduction: ${background || "[Your relevant background is needed]"}${themes[0]?.evidence ? ` A relevant example is: ${themes[0].evidence}` : ""} ${inputs.roleMotivation ? `Next, ${inputs.roleMotivation}` : "[Explain the work you want to do next]"}`,
        `Why this company: ${reasons.join("; ") || "[Add specific, truthful reasons for your interest]"}`,
        `Why this role / why now: ${inputs.roleMotivation || "[Your career decision is needed]"}`,
        `Support to discuss: ${themes.filter((v) => v.evidence).slice(0, 3).map((v) => v.evidence).join("; ") || "Add an example rather than asserting an unsupported achievement."}`].join("\n\n");
      break;
    }
    case "examples": {
      output.stories = (inputs.examples || []).filter((story) => Object.values(story).some((v) => typeof v === "string" && clean(v))).map((story) => {
        const gaps = ["context", "responsibility", "decision", "action", "result", "learning"].filter((key) => !clean(story[key]));
        if (/^we\b/i.test(clean(story.responsibility)) || !clean(story.responsibility)) gaps.push("Make your personal ownership explicit");
        if (/\b(improved things|better|good)\b/i.test(clean(story.result)) && clean(story.result).length < 35) gaps.push("Add a concrete observed result");
        if (/\d/.test(clean(story.result)) && !story.verified) gaps.push("Verify the result number before using it");
        return { ...story, gaps, themes: themes.filter((theme) => shared(theme.excerpt, Object.values(story).join(" ")) > 0).map((v) => v.excerpt) };
      });
      output.missing = output.stories.length < 3 ? ["Aim for three or four real examples; none are invented for you"] : [];
      output.text = output.stories.map((story, index) => [`${index + 1}. ${story.title || "Untitled example"}`,
        ...["context", "responsibility", "decision", "action", "result", "learning"].map((key) => `${key}: ${story[key] || "Needed"}`),
        `Role themes: ${story.themes.join("; ") || "No match yet"}`, `60–90 second cue: ${[story.responsibility, story.decision, story.action, story.result].filter(Boolean).join(" → ")}`,
        `Improve: ${story.gaps.join("; ") || "All six fields supplied; verify the facts and rehearse aloud."}`].join("\n")).join("\n\n");
      break;
    }
    case "practical": {
      const gaps = themes.filter((theme) => !theme.evidence);
      output.questions = ["Tell me about yourself.", "Why this company and role?", "Why are you considering a change?", "Which experience best prepares you for this work?", "Describe a challenge, disagreement or setback.", ...gaps.slice(0, 3).map((v) => `The posting asks for “${v.excerpt}”. How will you address the gap in your evidence?`)];
      output.text = [...output.questions, `Transition / gap explanation: ${inputs.transition || "Not supplied — prepare a truthful explanation if relevant"}`,
        ...[["compensation", "Compensation"], ["startDate", "Start date / notice"], ["location", "Location"], ["travel", "Travel"], ["schedule", "Schedule"], ["authorization", "Work authorization"], ["otherProcesses", "Other processes / timing"]].map(([key, label]) => `${label}: ${inputs[key] || "Not supplied — decide your truthful response"}`)].join("\n\n");
      break;
    }
    case "questions":
      output.questions = questionList(inputs, sources, themes);
      output.missing = facts.length ? [] : ["No research-linked question yet — add a sourced fact"];
      output.text = output.questions.map((question) => `${question.rank}. ${question.text}${question.researched ? `\nResearch-linked: ${question.source || "user-supplied fact; source URL missing"}` : ""}`).join("\n\n");
      break;
    case "reference":
      output.missing = ["brief", "candidacy", "examples", "questions"].filter((id) => !draftOf(artifacts, id)).map((id) => `Accept or write your ${id} draft`);
      output.text = [`CALL REFERENCE — ${inputs.jobTitle || "Role"} / ${inputs.company || "Company"}`,
        `${inputs.dateTime || "Date/time unknown"} — ${inputs.timezone || "Time zone unknown"} — ${inputs.connection || "Connection unknown"}`,
        `THREE FIT MESSAGES\n${themes.filter((v) => v.evidence).slice(0, 3).map((v) => `${v.excerpt}: ${v.evidence}`).join("\n") || "Evidence needed"}`,
        `INTRODUCTION CUES\n${draftOf(artifacts, "candidacy").slice(0, 700) || `Suggested framing (not yet accepted): ${buildTool("candidacy", inputs, sources).text.slice(0, 700)}`}`,
        `TWO REASONS\n${reasons.join("\n") || "Your reasons needed"}`,
        `EXAMPLE REMINDERS\n${(inputs.examples || []).filter((v) => v.title || v.action).slice(0, 4).map((v) => `${v.title || "Example"}: ${v.action || "Action needed"} → ${v.result || "Result needed"}`).join("\n") || "Examples needed"}`,
        `COMPANY FACTS\n${facts.map((v) => `${v.text} (${v.title}; ${v.publishedAt || "date unknown"})`).join("\n") || "Sourced facts needed"}`,
        `PRACTICAL\n${[inputs.compensation, inputs.startDate, inputs.location, inputs.travel, inputs.schedule].filter(Boolean).join("; ") || "Practical details needed"}`,
        `YOUR QUESTIONS\n${draftOf(artifacts, "questions") || `Suggested priorities (review and rank): ${questionList(inputs, sources, themes).map((question) => question.text).join("\n")}`}`,
        "ENVIRONMENT\nConfirm equipment, connection, charge, quiet space, notification settings and a buffer before/after the call.", inputs.environment || "Environment checklist not completed"].join("\n\n");
      break;
    case "followup": {
      const notes = [inputs.emphasized, inputs.learned, inputs.promises, inputs.nextStep].filter((v) => clean(v));
      output.missing = notes.length ? [] : ["Add notes from the actual conversation"];
      if (!notes.length) { output.text = "Add what was discussed before drafting a thank-you. No conversation is assumed."; break; }
      output.text = [`THANK-YOU DRAFT — review and edit; nothing is sent`, `Hello ${inputs.interviewer || "[interviewer]"},`,
        `Thank you for speaking with me about ${inputs.jobTitle || "the opportunity"}${inputs.company ? ` at ${inputs.company}` : ""}.${inputs.emphasized ? ` I appreciated the discussion of ${inputs.emphasized}.` : ""}${inputs.learned ? ` Learning about ${inputs.learned} was useful.` : ""}`,
        inputs.interestReasons ? `My interest connects to ${reasons.join("; ")}.` : "[Add your truthful interest if appropriate.]",
        inputs.promises ? `As discussed, I will ${inputs.promises}.` : "", inputs.nextStep ? `I look forward to ${inputs.nextStep}${inputs.nextTiming ? ` (${inputs.nextTiming})` : ""}.` : "",
        "NEXT ACTIONS", inputs.promises ? `Provide: ${inputs.promises}` : "No promised material recorded", `Next step: ${inputs.nextStep || "Confirm"}; timing: ${inputs.nextTiming || "Confirm"}`,
        `Unanswered: ${inputs.concerns || "None recorded"}`, `Improve before next interview: ${inputs.improveNext || "Review your rehearsal and actual call notes"}`].filter(Boolean).join("\n\n");
      break;
    }
    default: output.text = "Use the timed mock and repair controls below.";
  }
  return applyGrounding(output, stage, inputs, context, themes, sources);
}

function applyGrounding(output, stage, inputs, context, themes, sources) {
  if (!context) return { ...output, contextId: null, groundingStatus: "unlinked", evidenceIds: [], claimEvidence: [], draftKind: stage };
  const strength = contextStrength(context);
  const candidates = [...context.evidence].sort((a, b) => shared(b.quote, inputs.description) - shared(a.quote, inputs.description));
  const resume = candidates.filter((item) => item.sourceKind === "resume");
  const cover = candidates.filter((item) => item.sourceKind === "cover");
  const motivation = cover.find((item) => /drawn|interested|because|motiv|excited|attract|passion|appeal|continuity/i.test(item.quote)) || cover[0];
  const limit = strength.mode === "ideal" ? 5 : strength.level <= 2 ? 2 : strength.level === 3 ? 4 : 6;
  const selected = [...new Map([resume[0], motivation, ...candidates].filter(Boolean).map((item) => [item.id, item])).values()].slice(0, limit);
  const resumeText = resume[0]?.quote || "[Your relevant resume evidence is missing.]";
  const motivationText = motivation?.quote || "[A specific, truthful reason for interest is needed; it is not inferred.]";
  const action = resume.find((item) => /\b(wrote|built|supported|coordinated|planned|tested|managed|implemented|designed)\b/i.test(item.quote)) || resume[0];
  const second = resume.find((item) => item.id !== resume[0]?.id);
  const caution = `Requested framing: ${strength.label}. Historical document-generation strength: unknown. Document claims are source material, not independently verified facts.${strength.mode === "ideal" ? " Hypothetical study material is excluded." : ""}`;
  const role = context.job.title || inputs.jobTitle || "this role";
  const intro = `${resumeText}${strength.level > 2 && second ? ` ${second.quote}` : ""} I would connect that documented experience to the responsibilities of ${role}.`;
  const whyCompany = `${motivationText}${strength.level >= 4 ? " In discussion, I would connect that specific interest to the employer's stated priorities, without claiming experience I cannot support." : ""}`;
  const whyRole = `${action?.quote || "[A supported contribution is needed.]"} The relevant next-step connection is the work described for ${role}; my personal reason for making this move now still needs confirmation.`;
  const original = sources?.originalAnswer;
  const question = original?.question || themes[0]?.prompt || "Tell me about your relevant experience.";
  const opening = /why|interest|company|motivat/i.test(question) ? whyCompany : `${action?.quote || resumeText}${second && strength.level > 2 && second.id !== action?.id ? ` ${second.quote}` : ""}`;
  const sample = `${opening} For ${role}, I would explain how that contribution connects to ${themes[0]?.excerpt || "the role's priorities"}. [Follow-up detail needed: what decision was mine, why I chose it, and what result I can substantiate.]`;
  if (stage === "candidacy") output.text = `Tell me about yourself — roughly one-minute draft\n${intro}\n\nWhy this company\n${whyCompany}\n\nWhy this role and why now\n${whyRole}\n\nUnconfirmed user goal (not a sourced career claim): ${inputs.roleMotivation || "Please supply your real next-step goal."}`;
  else if (stage === "sample") output.text = `Question: ${question}\n\nSuggested spoken answer\n${sample}\n\nUse only what is true. Missing STAR details are questions, not invented achievements.`;
  else if (stage === "repairSuggestion") {
    const answer = typeof original?.answer === "string" ? original.answer : "";
    const fixes = [!answer ? "Select a real saved answer to make this repair answer-specific." : "Replace unsupported generalities with the documented contribution below.", /^we\b/i.test(answer.trim()) || /\bwe\b/i.test(answer) ? "Clarify your contribution separately from the team's result." : "Keep your precise personal ownership clear.", answer.split(/\s+/).length > 150 ? "Shorten the background and put the decision first." : "Lead directly with the point the question asks about.", /things|stuff|great|better/i.test(answer) ? "Replace vague terms with the exact action and an observed result you can confirm." : "Explain how you know the result; do not invent a metric."];
    output.text = `Question being repaired: ${question}\n\nOriginal typed answer — retained, UNVERIFIED historical input, not a generated personal claim\n${answer || "No selected answer yet."}\n\nTargeted improvements\n${fixes.join("\n")}\n\nRevised answer suggestion\n${sample}\n\nMissing decision/result detail must be supplied and confirmed; the original answer is not overwritten.`;
  } else if (stage === "examples") {
    output.stories = selected.map((item) => ({ title: `Story anchored in ${item.sourceKind}`, evidenceIds: [item.id], context: "Needed — describe the situation", responsibility: "Needed — distinguish your own responsibility", decision: "Needed — what did you choose and why?", action: item.quote, result: "Needed — what observation supports the outcome?", learning: "Needed — what did you learn?" }));
    output.text = output.stories.map((story, index) => `${index + 1}. ${story.title}\nSupported action/experience: ${story.action}\nContext: ${story.context}\nResponsibility: ${story.responsibility}\nDecision: ${story.decision}\nResult: ${story.result}\nLearning: ${story.learning}`).join("\n\n");
  } else if (stage === "reference") {
    output.text = [`CALL REFERENCE — ${role} / ${context.job.company || inputs.company || "Company"}`, `${inputs.dateTime || "Date/time needed"} — ${inputs.timezone || "Time zone needed"} — ${inputs.connection || "Connection instructions needed"}`,
      `INTRODUCTION\n${intro}`, `WHY THIS COMPANY\n${whyCompany}`, `ROLE FIT\n${selected.slice(0, 3).map((item) => item.quote).join("\n")}`, `EXAMPLE CUES\n${action?.quote || "Supported action needed"}\nDecision, responsibility, result and learning: supply missing details; do not infer them.`,
      `COMPANY SOURCE MATERIAL\n${availableFacts(inputs, sources).map((fact) => `${fact.text} (${fact.title}; ${fact.publishedAt || "date unknown"})`).join("\n") || "Sourced facts needed"}`,
      `PRACTICAL PREFERENCES — USER SUPPLIED\n${[inputs.compensation, inputs.startDate, inputs.location, inputs.travel, inputs.schedule].filter(Boolean).join("; ") || "Decide truthful practical responses"}`,
      `QUESTIONS TO ASK\n${questionList(inputs, sources, themes).map((item) => item.text).join("\n")}`, `ENVIRONMENT\nConfirm equipment, connection, charge, quiet space and appointment buffer. ${inputs.environment || "Checklist not completed."}`].join("\n\n");
  } else if (stage === "followup") {
    if (![inputs.emphasized, inputs.learned, inputs.promises, inputs.nextStep].some((value) => clean(value))) output.text = "Add notes from the actual conversation before drafting a thank-you; no conversation is assumed.";
    else output.text = [`THANK-YOU DRAFT — review the user-supplied conversation details`, `Hello ${inputs.interviewer || "[interviewer]"},`, `Thank you for discussing ${role}${context.job.company ? ` at ${context.job.company}` : ""}. ${inputs.emphasized ? `I appreciated the conversation about ${inputs.emphasized}.` : ""}`,
      `My relevant experience is reflected in this documented contribution: ${action?.quote || resumeText}`, `My interest in the organization connects to this application statement: ${motivationText}`,
      "USER-SUPPLIED FOLLOW-UP NOTES — NOT DOCUMENT-VERIFIED PERSONAL ACHIEVEMENTS", `What I learned: ${inputs.learned || "Not recorded"}`, `Promised action: ${inputs.promises || "None recorded"}`, `Next step: ${inputs.nextStep || "Confirm"}; timing: ${inputs.nextTiming || "Confirm"}`, `Unanswered: ${inputs.concerns || "None recorded"}`, `Improve next: ${inputs.improveNext || "Review the actual call and rehearsal"}`].join("\n\n");
  } else {
    output.text = `PLANNING NOTES / QUESTIONS — supplied inputs and suggested interpretation; not independently verified personal claims\n${output.text}\n\nSUPPORTED CANDIDATE ANCHORS\n${selected.map((item) => item.quote).join("\n")}`;
  }
  const confirmed = context.evidence.filter((item) => item.sourceKind === "supplement");
  if (confirmed.length) output.text += `\n\nCONFIRMED SUPPLEMENTAL EXPERIENCE — user supplied, not independently verified\n${confirmed.map((item) => item.quote).join("\n")}`;
  output.text += `\n\nSOURCE AND FRAMING LIMITS\n${caution}`;
  if (context.conflicts.length) output.text += `\n\nUNRESOLVED SOURCE CONFLICTS\n${context.conflicts.map((conflict) => `${conflict.reason} (${conflict.evidenceIds.join(", ")})`).join("\n")}\nNo conflicting result is adopted as certain; resolve the actual facts and review again.`;
  output.missing = [...output.missing, ...context.missing, ...(context.conflicts.length ? ["Resolve source conflicts"] : [])];
  const claimEvidence = [];
  for (const item of context.evidence) { let start = output.text.indexOf(item.quote); while (start >= 0) { claimEvidence.push({ start, end: start + item.quote.length, quote: item.quote, evidenceIds: [item.id] }); start = output.text.indexOf(item.quote, start + item.quote.length); } }
  return { ...output, contextId: context.id, groundingStatus: context.missing.length || context.conflicts.length ? "incomplete" : "linked", evidenceIds: [...new Set(claimEvidence.flatMap((claim) => claim.evidenceIds))], claimEvidence, draftKind: stage, basis: context.id };
}
export function buildMockQuestions(inputs, artifacts = {}, seed = 1) {
  const themes = roleThemes(inputs);
  const own = draftOf(artifacts, "questions").split("\n").find((line) => line.includes("?"));
  const required = [
    { category: "introduction", text: "Tell me about yourself." },
    { category: "motivation", text: `Why ${inputs.company || "this company"} and ${inputs.jobTitle || "this role"}?` },
    { category: "experience", text: themes[0]?.prompt || "Describe a relevant accomplishment and your personal contribution." },
    { category: "follow-up", text: "What alternatives did you consider, and why did you choose that approach?" },
    { category: "practical", text: "What are your availability and work-arrangement requirements?" },
    { category: "your questions", text: own || "What would you ask the interviewer if time were limited?" },
  ];
  let state = (Number(seed) || 1) >>> 0;
  for (let index = required.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const other = state % (index + 1);
    [required[index], required[other]] = [required[other], required[index]];
  }
  return required.map((question, index) => ({ ...question, id: `${question.category}-${index}` }));
}

export function reviewAnswer({ question = "", answer = "", seconds = 0, checks = {}, posting = null, resume = "", coverLetter = "" } = {}) {
  const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const heuristic = critiqueAnswerLocal({ question, answer, posting, resume, coverLetter, metrics: duration ? { durationSec: duration } : null });
  const ratings = Object.fromEntries(["directness", "specificity", "ownership", "relevance", "brevity"].map((key) => [key, [1, 2, 3, 4, 5].includes(Number(checks[key])) ? Number(checks[key]) : null]));
  return { heuristic, checks: ratings, seconds: duration, reviewedAt: new Date().toISOString(), label: "Heuristic typed-text review; spoken delivery was not measured" };
}

export function rankRepairs(attempts = []) {
  const hints = {
    directness: "Answer the question in your first sentence before adding context.", specificity: "Add a real decision, action or concrete observation from your example.",
    ownership: "Explain exactly what you personally owned and distinguish the team's contribution.", relevance: "Connect your example to the role requirement being asked about.",
    brevity: "Keep one main point and its strongest supporting example; rehearse a shorter version.",
  };
  return attempts.filter((attempt) => attempt.review).map((attempt) => {
    const low = Object.entries(attempt.review.checks || {}).filter(([, value]) => value !== null && value <= 2).map(([key]) => key);
    const score = Number(attempt.review.heuristic?.score);
    return { id: attempt.id, answer: attempt.answer, question: attempt.question, score: Number.isFinite(score) ? score : null,
      priority: low.length * 100 + (Number.isFinite(score) ? 100 - score : 0),
      guidance: [...low.map((key) => `${key}: ${hints[key]}`), ...(attempt.review.heuristic?.improvements || []).map((v) => typeof v === "string" ? v : v?.text || "Review the rubric")],
      followups: ["What did you personally do?", "How did you know the result?", "What would you change next time?"] };
  }).filter((entry) => entry.guidance.length).sort((a, b) => b.priority - a.priority).slice(0, 3);
}
