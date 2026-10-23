"use client";

import { useState } from "react";
import { useEngine } from "@/app/settings/engine";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import styles from "./preparation.module.css";

function Field({ label, value = "", onChange, multiline = false, type = "text" }) {
  return <label className={styles.field}><span>{label}</span>{multiline
    ? <textarea aria-label={label} value={value} maxLength={20000} rows={4} onChange={(event) => onChange(event.target.value)} />
    : <input aria-label={label} type={type} value={value} maxLength={20000} onChange={(event) => onChange(event.target.value)} />}</label>;
}
function SourceLinks({ articles }) {
  return <ul className={styles.sourceList}>{articles.map((article, index) => {
    const href = safeExternalHref(article.url);
    return <li key={`${article.title}-${index}`}><strong>{article.title || "Untitled source"}</strong><p>{article.summary || article.text}</p>{href ? <a href={href} target="_blank" rel="noopener noreferrer">Open source</a> : <span>Source link unavailable or unsafe</span>}<span> · Publication: {article.date || article.publishedAt || "unknown"}</span></li>;
  })}</ul>;
}

export default function PreparationTools({ stage, inputs, onInput, sources, workspaceSources, update, artifact, build, accept, keep, onDraft, basis, onOpenExisting }) {
  const { engine } = useEngine();
  const [notice, setNotice] = useState("");
  const field = (name, label, multiline = false, type = "text") => <Field key={name} label={label} value={inputs[name]} onChange={(value) => onInput(name, value)} multiline={multiline} type={type} />;
  const patchList = (name, index, key, value) => onInput(name, inputs[name].map((entry, i) => i === index ? { ...entry, [key]: value } : entry));
  const seedDocuments = () => {
    update((workspace) => ({ ...workspace, inputs: { ...workspace.inputs, resume: sources.docs.resume || workspace.inputs.resume, coverLetter: sources.docs.coverLetter || workspace.inputs.coverLetter } }));
    setNotice("Submitted text copied into your editable inputs. Review it before building.");
  };
  const usePack = () => {
    const pack = sources.pack.pack;
    const sections = sources.pack.completeSections;
    const readLines = (name) => sections.includes(name) ? (pack?.sections?.[name]?.answer?.lines || []).map((line) => line.text).filter(Boolean).join("\n") : "";
    const about = readLines("aboutYou"); const why = readLines("whyRole");
    const questions = sections.includes("askThem") ? (pack?.sections?.askThem?.questions || []).map((item) => item.text).filter(Boolean).join("\n") : "";
    update((workspace) => ({ ...workspace, sources: { ...workspace.sources, existingPrep: { about, why, questions, status: sources.pack.status } } }));
    setNotice("Available existing prep copied as source material. It does not replace your own facts or drafts.");
  };
  let content;
  if (stage === "brief") content = <>
    <p>Use the invitation to confirm the format before preparing detailed answers.</p>
    <div className={styles.grid}>{field("jobTitle", "Job title")}{field("company", "Company")}{field("interviewer", "Interviewer name")}{field("interviewerTitle", "Interviewer title")}
      <label className={styles.field}><span>Interviewer audience</span><select aria-label="Interviewer audience" value={inputs.audience} onChange={(event) => onInput("audience", event.target.value)}><option value="recruiter">Recruiter</option><option value="manager">Hiring manager / specialist</option></select></label>
      {field("dateTime", "Interview date and time", false, "datetime-local")}{field("timezone", "Time zone")}{field("duration", "Expected minutes", false, "number")}{field("format", "Interview format")}{field("connection", "Connection instructions")}</div>
    {field("employerMaterials", "Employer materials and assessment instructions", true)}
    <section className={styles.sources}><h4>Application sources</h4><p>Submitted documents: {sources.docs.status === "done" ? sources.docs.resume || sources.docs.coverLetter ? "text available" : "no submitted documents found" : sources.docs.status}. {sources.docs.error}</p>
      {sources.docs.status === "error" && <button onClick={sources.docs.retry}>Retry submitted documents</button>}
      <button disabled={!sources.docs.resume && !sources.docs.coverLetter} onClick={seedDocuments}>Use submitted document text</button>
      <p>Existing prep: {sources.pack.status}. {sources.pack.error}</p>
      <div className={styles.actions}><button disabled={sources.pack.status === "loading"} onClick={sources.loadPack}>Reload existing prep</button><button disabled={!sources.pack.pack} onClick={usePack}>Use existing prep as source</button><button disabled={!onOpenExisting} onClick={() => onOpenExisting?.("prep")}>Open Tracking prep</button><button disabled title="This historical generator does not bind current documents, strength and independent review.">Legacy prep generation unavailable here</button></div>
      <p>Historical prep is source-only with document, strength and review basis unknown. Build linked preparation here; opening Tracking leaves this reviewed pipeline. Company research remains explicit and may use the configured engine ({engine}).</p>
      {workspaceSources.existingPrep && <details><summary>Existing prep source snapshot</summary><pre>{JSON.stringify(workspaceSources.existingPrep, null, 2)}</pre></details>}
    </section>
  </>;
  if (stage === "role") content = <>{field("description", "Job description", true)}{field("resume", "Submitted resume or experience text", true)}<p>Matches quote your supplied text. A gap is a prompt to find evidence, not proof you lack a skill.</p></>;
  if (stage === "company") content = <>
    <p>Existing research favors positive news and is not comprehensive. Use employer instructions and official sources first; verify summaries and dates.</p>
    <div className={styles.actions}><button disabled={!inputs.company || sources.brief.status === "loading"} onClick={sources.research}>Research company</button><span>Engine: {engine} · {sources.brief.status}</span></div>
    {sources.brief.error && <p role="alert">{sources.brief.error} <button onClick={sources.research}>Retry company research</button></p>}
    {sources.brief.warnings.map((warning, index) => <p key={index}>{typeof warning === "string" ? warning : "Research may be incomplete; verify the sources."}</p>)}
    <SourceLinks articles={sources.brief.articles} />
    {sources.researchResult && <><p>{sources.researchResult.stale ? "Inputs changed during research. Review this earlier-input result before using it." : "Research is ready for review."}</p><button onClick={() => update((workspace) => ({ ...workspace, sources: { ...workspace.sources, articles: sources.researchResult.articles } }))}>Use reviewed research snapshot</button></>}
    <div className={styles.grid}>{field("product", "Products, services and problem solved")}{field("buyer", "Buyer or funder")}{field("user", "User")}{field("beneficiary", "Beneficiary")}{field("businessModel", "Business or operating model")}{field("differentiation", "What distinguishes the organization")}{field("priorities", "Current priorities")}{field("culture", "Working environment evidence")}</div>
    <h4>Employer / official / supplied source facts</h4>{inputs.facts.map((fact, index) => <fieldset className={styles.card} key={index}><legend>Source fact {index + 1}</legend>
      {[['text', 'Fact or source material'], ['title', 'Source title'], ['url', 'Source URL'], ['publishedAt', 'Publication date'], ['eventAt', 'Event date']].map(([name, label]) => <Field key={name} label={`${label} ${index + 1}`} value={fact[name]} onChange={(value) => patchList("facts", index, name, value)} multiline={name === "text"} />)}
      <label><input type="checkbox" checked={fact.confirmed} onChange={(event) => patchList("facts", index, "confirmed", event.target.checked)} /> I checked this claim against the source</label>
    </fieldset>)}<button disabled={inputs.facts.length >= 12} onClick={() => onInput("facts", [...inputs.facts, { text: "", title: "", url: "", publishedAt: "", eventAt: "", confirmed: false }])}>Add source fact</button>
    {field("interestReasons", "Your specific interest reasons (one per line)", true)}{field("companyInterpretation", "Your interpretation — unconfirmed", true)}{field("companyUnknowns", "Unanswered company or role questions (one per line)", true)}
    <SourceLinks articles={workspaceSources.articles || []} />
  </>;
  if (stage === "interviewer") content = <>{field("biography", "Supplied professional biography or notes", true)}<p>Professional information you supply only. This tool does not fetch profiles or infer private background.</p></>;
  if (stage === "candidacy") content = <>{field("background", "Your relevant background", true)}{field("interestReasons", "Your specific interest reasons (one per line)", true)}{field("roleMotivation", "Why this role and why now", true)}</>;
  if (stage === "examples") content = <><p>Build three or four real examples. Keep ownership, verified results and lessons distinct.</p>{inputs.examples.map((example, index) => <fieldset className={styles.card} key={index}><legend>Example {index + 1}</legend>{["title", "context", "responsibility", "decision", "action", "result", "learning"].map((name) => <Field key={name} label={`Example ${index + 1} ${name}`} value={example[name]} onChange={(value) => patchList("examples", index, name, value)} multiline={name !== "title"} />)}<label><input type="checkbox" checked={example.verified} onChange={(event) => patchList("examples", index, "verified", event.target.checked)} /> I verified any result numbers</label></fieldset>)}<button disabled={inputs.examples.length >= 8} onClick={() => onInput("examples", [...inputs.examples, { title: "", context: "", responsibility: "", decision: "", action: "", result: "", learning: "", verified: false }])}>Add real example</button></>;
  if (stage === "practical") content = <>{field("transition", "Career transition or requirement gap explanation", true)}<div className={styles.grid}>{field("compensation", "Compensation position")}{field("startDate", "Start date and notice")}{field("location", "Location preference")}{field("travel", "Travel availability")}{field("schedule", "Schedule constraints")}{field("authorization", "Work authorization response")}{field("otherProcesses", "Other interview timing")}</div><p>Only enter truthful information you want in your private reference. Blank details remain unknown.</p></>;
  if (stage === "questions") content = <><p>Questions use your research and open issues. After accepting a suggestion, edit the numbered list in priority order; the first question is your top choice.</p>{field("companyUnknowns", "Unanswered company or role questions (one per line)", true)}</>;
  return <div><div className={styles.editor}>{content}</div>{notice && <p role="status">{notice}</p>}<div className={styles.actions}><button className={styles.primary} onClick={build}>Build {stage === "role" ? "role and evidence" : stage === "questions" ? "questions to ask" : stage === "examples" ? "reusable examples" : stage === "brief" ? "interview brief" : stage === "company" ? "company brief" : stage === "interviewer" ? "interviewer focus" : stage === "candidacy" ? "candidacy" : "common and practical questions"}</button></div>
    <DraftEditor stage={stage} artifact={artifact} basis={basis} accept={accept} keep={keep} onDraft={onDraft} />
    {stage === "questions" && artifact?.draft && <section aria-label="Question priorities"><h4>Your first question is the top choice</h4>{artifact.draft.split(/\n\s*\n/).filter(Boolean).map((question, index, all) => <div className={styles.card} key={`${index}-${question}`}><p>{question}</p><button disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { const next = [...all]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onDraft(next.map((value, i) => `${i + 1}. ${value.replace(/^\d+\.\s*/, "")}`).join("\n\n")); }}>Move up</button><button disabled={index === 0} aria-label={`Make question ${index + 1} top choice`} onClick={() => { const next = [question, ...all.filter((_, i) => i !== index)]; onDraft(next.map((value, i) => `${i + 1}. ${value.replace(/^\d+\.\s*/, "")}`).join("\n\n")); }}>Make top choice</button></div>)}</section>}
  </div>;
}

export function DraftEditor({ stage, artifact, basis, accept, keep, onDraft, reviewRequired = true }) {
  return <section className={styles.draft} aria-label={`${stage} output`}>
    {artifact?.suggestion && <div className={styles.suggestion}><h4>Suggested draft — unreviewed</h4><p>{artifact.suggestion.basis !== basis ? "Stale suggestion — inputs have changed. Rebuild or review carefully." : "Built from your current inputs. Review before accepting."}</p>{artifact.suggestion.missing?.length > 0 && <p role="status">Needed: {artifact.suggestion.missing.join("; ")}</p>}<pre>{artifact.suggestion.text || "More input is needed to produce this draft."}</pre><div className={styles.actions}><button onClick={accept}>{reviewRequired ? "Save unreviewed suggestion as draft" : "Accept suggestion"}</button><button onClick={keep}>Keep current draft</button></div></div>}
    <label className={styles.field}><span>Your editable {stage} draft</span><textarea aria-label={`Your editable ${stage} draft`} rows={8} value={artifact?.draft || ""} maxLength={20000} onChange={(event) => onDraft(event.target.value)} /></label>
    {artifact?.draft && artifact.acceptedBasis !== basis && <p role="status">Draft is stale: inputs or sources changed. Your edits are retained.</p>}
  </section>;
}
