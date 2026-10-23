import { describe, it, expect } from "vitest";
import { STAGES, createInputs, buildTool, buildMockQuestions, reviewAnswer, rankRepairs } from "./workbench";
const P = "Own incident response and on-call reliability. Lead SQL migration planning. Align support and engineering. Interview municipal dispatch users. Mentor junior engineers. Report service reliability outcomes.";
const R = "At Elm Tools I debugged incident alerts and owned on-call runbooks. I planned a PostgreSQL migration and rehearsed rollback. I aligned support and engineering on incident handoffs. I organized a museum exhibition.";
function fixture() {
  return { ...createInputs(), jobTitle:"Platform engineer", company:"Cedar Transit Tools", description:P, resume:R,
    background:"I planned a PostgreSQL migration and rehearsed rollback.", interviewer:"Jordan Vale", interviewerTitle:"Engineering manager", audience:"manager", biography:"Owns service reliability, SQL migrations and engineering coaching.", dateTime:"2026-11-05 10:30", timezone:"America/Chicago", duration:"25", connection:"Call invitation number", product:"dispatch scheduling", buyer:"municipal procurement", user:"dispatchers", beneficiary:"passengers", businessModel:"annual subscription", differentiation:"offline workflow", priorities:"pilot in two cities", culture:"cross-team delivery", companyInterpretation:"The pilot may need migration support", companyUnknowns:"on-call rotation", interestReasons:"resilient public-service tools\ncross-team delivery", roleMotivation:"I want to own reliable public-service platforms", transition:"I want broader platform responsibility", startDate:"four weeks notice", location:"Prefer remote",
    facts:[{text:"pilot in two cities",title:"Pilot announcement",url:"https://example.org/cedar/pilot",publishedAt:"2026-09-01",eventAt:"2026-08-20",confirmed:false},{text:"offline workflow",title:"Offline design",url:"https://example.org/cedar/offline",publishedAt:"",eventAt:"",confirmed:true}],
    examples:[{title:"Alert cleanup",context:"During an on-call rotation incident alerts repeated",responsibility:"I owned incident runbooks",decision:"I chose to group repeated alerts",action:"I debugged alerts and updated the runbook",result:"fewer repeated alerts in the next on-call rotation",learning:"I learned to rehearse incident handoffs",verified:true}], emphasized:"rollback planning",learned:"two migration stages",promises:"send public migration outline",nextStep:"technical conversation",nextTiming:"next week",concerns:"on-call rotation unclear" };
}
const text = (value) => JSON.stringify(value);
describe("N176 twelve grounded preparation tools", () => {
  it("defines twelve distinct activities in the supplied preparation order", () => {
    expect(STAGES.map(v=>v.id)).toEqual(["brief","role","company","interviewer","candidacy","examples","practical","questions","mock","repair","reference","followup"]);
  });
  it("compiles supplied logistics and exposes missing details without guessing", () => {
    const input=fixture(), full=buildTool("brief",input);
    for(const value of ["Jordan Vale","America/Chicago","2026-11-05","Call invitation number"]) expect(full.text).toContain(value);
    const missing=buildTool("brief",{...input,interviewer:"",timezone:"",connection:""});
    expect(text(missing.missing)).toMatch(/interviewer|name/i); expect(text(missing.missing)).toMatch(/zone/i); expect(text(missing.missing)).toMatch(/connection/i);
    expect(missing.text).not.toContain("America/Chicago");
  });
  it("extracts distinct source themes and changes literal resume evidence when material changes", () => {
    const input=fixture(), role=buildTool("role",input);
    expect(role.themes.length).toBeGreaterThanOrEqual(4); expect(role.themes.length).toBeLessThanOrEqual(6);
    expect(new Set(role.themes.map(v=>v.excerpt)).size).toBe(role.themes.length);
    for(const theme of role.themes) { expect(P).toContain(theme.excerpt); expect(theme.prompt).toBeTruthy(); if(theme.evidence) expect(R).toContain(theme.evidence); }
    const sql=role.themes.find(v=>/SQL/.test(v.excerpt)); expect(sql.evidence).toContain("PostgreSQL migration");
    const mentor=role.themes.find(v=>/Mentor/.test(v.excerpt)); expect(mentor.evidence).toBe("");
    const changed=buildTool("role",{...input,background:"",resume:"I interviewed municipal dispatch users and tested their workflow."});
    expect(changed.themes.find(v=>/SQL/.test(v.excerpt)).evidence).toBe("");
    expect(changed.themes.find(v=>/Interview municipal/.test(v.excerpt)).evidence).toContain("dispatch users");
    expect(buildTool("role",createInputs()).missing.length).toBeGreaterThan(0);
    expect(buildTool("role",{...createInputs(),description:"Maintain SQL databases."}).missing.length).toBeGreaterThan(0);
  });
  it("keeps sourced facts, unknown dates, buyer/user/beneficiary and interpretation distinct", () => {
    const company=buildTool("company",fixture());
    for(const value of ["municipal procurement","dispatchers","passengers","2026-09-01","2026-08-20","https://example.org/cedar/pilot","resilient public-service tools","unconfirmed"]) expect(company.text).toContain(value);
    expect(company.facts[1].publishedAt).toBe(""); expect(company.text).toMatch(/publication: unknown/i);
    expect(company.text).toMatch(/verify|not independently verified/i);
    expect(buildTool("company",createInputs()).missing.length).toBeGreaterThan(0);
  });
  it("adapts professional audience without fabricating a biography", () => {
    const input=fixture(), manager=buildTool("interviewer",input), recruiter=buildTool("interviewer",{...input,audience:"recruiter",biography:"Coordinates hiring process and candidate logistics."});
    expect(manager.text).toMatch(/technical|decisions|responsibilities/i); expect(recruiter.text).toMatch(/process|logistics/i); expect(manager.text).not.toBe(recruiter.text);
    const empty=buildTool("interviewer",createInputs()); expect(empty.missing.length).toBeGreaterThan(0); expect(empty.text).toMatch(/unknown/i); expect(empty.text).not.toContain("Jordan Vale");
  });
  it("composes candidacy only from supplied experience and motivation", () => {
    const full=buildTool("candidacy",fixture()); expect(full.text).toContain("PostgreSQL migration"); expect(full.text).toContain("resilient public-service tools"); expect(full.text).toContain("reliable public-service platforms"); expect(full.text).toMatch(/suggested framing/i);
    const changed=buildTool("candidacy",{...fixture(),background:"I interviewed dispatchers about their scheduling workflow."}); expect(changed.text).toContain("interviewed dispatchers");
    const empty=buildTool("candidacy",createInputs()); expect(empty.missing.length).toBeGreaterThan(0); expect(empty.text).not.toMatch(/17%|40%|won an award|generated revenue/i);
    const canary=buildTool("candidacy",{...createInputs(),background:"I verified 17% reduction in repeated alerts."}); expect(canary.text).toContain("17%");
    expect(full.basis).toEqual(expect.any(String)); expect(full.basis.length).toBeGreaterThan(0);
    expect(full.basis).toBe(buildTool("candidacy",fixture()).basis); expect(changed.basis).not.toBe(full.basis);
  });
  it("preserves six story fields, flags weak ownership and unverified numbers, invents no examples", () => {
    const input=fixture(), stories=buildTool("examples",input); expect(stories.stories).toHaveLength(1);
    for(const key of ["context","responsibility","decision","action","result","learning"]) expect(stories.stories[0][key]).toBe(input.examples[0][key]);
    expect(stories.stories[0].themes.length).toBeGreaterThan(0); expect(stories.text).toContain("60–90"); expect(stories.text).not.toMatch(/\d+%/);
    const weak=buildTool("examples",{...input,examples:[{...input.examples[0],responsibility:"we improved things",result:"40% better",verified:false}]}); expect(text(weak.stories[0].gaps)).toMatch(/personal|ownership/i); expect(text(weak.stories[0].gaps)).toMatch(/verify.*number/i);
    expect(buildTool("examples",createInputs()).stories).toHaveLength(0);
  });
  it("generates common questions plus evidence gaps and keeps practical unknowns truthful", () => {
    const practical=buildTool("practical",fixture()); expect(practical.text).toMatch(/Tell me about yourself/i); expect(practical.text).toMatch(/Mentor.*gap|gap[\s\S]*Mentor/i); expect(practical.text).toContain("four weeks notice"); expect(practical.text).toContain("Prefer remote");
    expect(practical.text).toMatch(/Compensation: Not supplied/i); expect(practical.text).toMatch(/Work authorization: Not supplied/i);
  });
  it("ranks source-linked audience questions and labels absent research", () => {
    const questions=buildTool("questions",fixture()); expect(questions.questions.length).toBeGreaterThanOrEqual(3); expect(questions.questions.length).toBeLessThanOrEqual(5);
    expect(questions.questions.some(v=>v.researched&&v.text.includes("pilot in two cities")&&v.source==="https://example.org/cedar/pilot")).toBe(true);
    expect(questions.text).toContain("on-call rotation"); expect(questions.questions.map(v=>v.rank)).toEqual(questions.questions.map((_,i)=>i+1));
    const empty=buildTool("questions",createInputs()); expect(empty.missing.join(" ")).toMatch(/research|source/i); expect(empty.questions.some(v=>v.researched)).toBe(false);
  });
  it("builds reproducible varied rehearsal sequences preserving required categories", () => {
    const input=fixture(), a=buildMockQuestions(input,{},1), repeat=buildMockQuestions(input,{},1), varied=buildMockQuestions(input,{},9);
    expect(a).toEqual(repeat); expect(a.map(v=>v.text)).not.toEqual(varied.map(v=>v.text));
    expect(new Set(a.map(v=>v.category))).toEqual(new Set(["introduction","motivation","experience","follow-up","practical","your questions"])); expect(a.every(v=>v.text&&v.id)).toBe(true);
  });
  it("reviews actual typed answers with heuristic and five independent manual checks; prioritizes weak attempts", () => {
    const checks={directness:1,specificity:2,ownership:1,relevance:2,brevity:1};
    const weak=reviewAnswer({question:"Describe a SQL migration",answer:"We improved things.",seconds:180,checks,posting:{description:P},resume:R});
    expect(weak.heuristic.score).toEqual(expect.any(Number)); expect(weak.checks).toEqual(checks); expect(weak.seconds).toBe(180); expect(weak.label).toMatch(/heuristic|typed/i); expect(weak.label).toMatch(/not measured/i);
    const good=reviewAnswer({question:"Describe a SQL migration",answer:"In my previous role I owned a SQL migration. I planned rollback, rehearsed it, and documented the result in the runbook.",seconds:65,checks:{directness:5,specificity:5,ownership:5,relevance:5,brevity:5},posting:{description:P},resume:R});
    const repairs=rankRepairs([{id:"strong",answer:"strong",question:"SQL",review:good},{id:"weak",answer:"We improved things.",question:"SQL",review:weak},{id:"unreviewed",answer:"not reviewed"}]);
    expect(repairs[0].id).toBe("weak"); expect(text(repairs[0].guidance)).toMatch(/ownership/); expect(text(repairs[0].guidance)).toMatch(/brevity/); expect(repairs[0].followups.length).toBeGreaterThan(0); expect(repairs.length).toBeLessThanOrEqual(3); expect(rankRepairs([])).toEqual([]);
  });
  it("builds a compact reference from accepted drafts and preserves contextual postcall promises", () => {
    const input=fixture(), reference=buildTool("reference",input,{}, {brief:{draft:"confirmed brief"},candidacy:{draft:"EDITED INTRO SENTINEL"},examples:{draft:"real example"},questions:{draft:"TOP EDITED QUESTION?"}});
    for(const value of ["America/Chicago","EDITED INTRO SENTINEL","TOP EDITED QUESTION?","four weeks notice","pilot in two cities","runbook"]) expect(reference.text).toContain(value);
    expect(reference.text).toMatch(/equipment|quiet|charge/i);
    const followup=buildTool("followup",input); for(const value of ["rollback planning","two migration stages","send public migration outline","technical conversation","next week","on-call rotation unclear"]) expect(followup.text).toContain(value);
    expect(followup.text).toMatch(/nothing is sent/i);
    const empty=buildTool("followup",createInputs()); expect(empty.missing.length).toBeGreaterThan(0); expect(empty.text).not.toContain("rollback planning"); expect(empty.text).toMatch(/no conversation|add.*notes|discussed/i);
  });
});

it("prioritizes repeated explicit requirements beyond early optional posting material",()=>{
  const input=createInputs();input.description=["Install copper cabling and configure ethernet switches.","Prepare payroll tax filings and reconcile deductions.","Negotiate legal vendor contracts and liability clauses.","Calibrate optical sensors and measure laser accuracy.","Operate warehouse forklifts and handle shipping pallets.","Create retail marketing campaigns and track store promotions.","REQUIRED: own SQL migration planning and rollback decisions.","The primary responsibility is SQL migration planning and rollback decisions.","Most importantly, SQL migration planning and rollback decisions determine success."].join(" ");input.resume="I planned a SQL migration and rehearsed rollback decisions.";
  const output=buildTool("role",input);expect(output.themes.length).toBeGreaterThanOrEqual(4);expect(output.themes.length).toBeLessThanOrEqual(6);
  const required=output.themes.find(theme=>/SQL migration planning/i.test(theme.excerpt));expect(required,"Repeated required SQL responsibility must not disappear behind the first six optional sentences").toBeTruthy();expect(input.description).toContain(required.excerpt);expect(required.evidence).toContain("SQL migration");
});

// Amended owner grounding oracles; legacy null-context fixtures above remain useful unreviewed-draft tests.
describe("N176 both application-ready documents and shared strength",()=>{
 async function grounded(level=3,cover="I value Cedar's offline scheduling tools because dispatchers need continuity during outages.",mode=""){
  const {createCandidateContext}=await import("./candidateContext");const {createHash}=await import("node:crypto");const resume="I supported the SQL migration. I wrote the rollback checklist. I coordinated the support handoff. The team migrated twelve databases.";
  const doc=(kind,text)=>({kind,state:"ready",origin:"generated-application-ready",documentId:`${kind}-A1`,contentIdentity:`sha256:${createHash("sha256").update(text).digest("hex")}`,text,createdAt:null,error:null});
  return createCandidateContext({snapshot:{accountId:"A",applicationId:"CEDAR",mode:"application",status:"ready",resume:doc("resume",resume),cover:doc("cover",cover),observedAt:"2026-10-23",consistency:"stable-double-read",historicalStrength:{resume:null,cover:null}},job:{title:"Platform engineer",company:"Cedar",description:"Own SQL migration planning. Support dispatchers during outages. Coordinate engineering and support."},requestedStrength:{aggressiveness:level,tailorMode:mode}});
 }
 it("both application-ready documents change actual personal preparation",async()=>{const input=fixture();const context=await grounded();for(const stage of ["candidacy","examples","sample","repairSuggestion","reference","followup"]){const out=buildTool(stage,input,{}, {},context);expect(out.contextId,stage).toBe(context.id);expect(out.claimEvidence,stage).toEqual(expect.any(Array));expect(out.evidenceIds.length,stage).toBeGreaterThan(0);for(const claim of out.claimEvidence){expect(out.text.slice(claim.start,claim.end)).toBe(claim.quote);expect(claim.evidenceIds.length).toBeGreaterThan(0);for(const id of claim.evidenceIds)expect(context.evidence.some(e=>e.id===id)).toBe(true);}expect(out.text).not.toMatch(/17%|73%|solely led|single-handedly/);}
  const before=buildTool("candidacy",input,{}, {},context);const afterContext=await grounded(3,"I want to help dispatchers coordinate accessible transport.");const after=buildTool("candidacy",input,{}, {},afterContext);expect(before.text).toMatch(/offline scheduling|continuity during outages/);expect(after.text).toContain("accessible transport");expect(after.text).not.toBe(before.text);
 });
 it("shared requested strength changes supported framing without changing facts",async()=>{const input=fixture(),light=await grounded(1),strong=await grounded(5);const a=buildTool("candidacy",input,{}, {},light),b=buildTool("candidacy",input,{}, {},strong);expect(a.text).not.toBe(b.text);for(const out of [a,b]){expect(out.text).not.toMatch(/17%|73%|forty migrations|I led the migration/);expect(out.evidenceIds.every(id=>light.evidence.some(e=>e.id===id))).toBe(true);}const ideal=await grounded(3,undefined,"ideal");expect(ideal.requestedStrength.aggressiveness).toBe(3);expect(buildTool("examples",input,{}, {},ideal).text).not.toContain("73%");expect(ideal.historicalStrength.resume).toBeNull();});
 it("story anchors cite evidence and request unsupported STAR details",async()=>{const out=buildTool("examples",{...fixture(),examples:[]},{},{},await grounded());expect(out.text).toContain("rollback checklist");expect(out.text).toMatch(/what|needed|missing|confirm|question/i);expect(out.text).not.toMatch(/reduced.*17%|solely led/);expect(out.claimEvidence.length).toBeGreaterThan(0);});
 it("unlinked legacy outputs are never retroactively certified",()=>{const out=buildTool("candidacy",fixture());expect(out.groundingStatus).toBe("unlinked");expect(out.contextId??null).toBeNull();});
 it("composes separate usable candidacy answers rather than a source-quote appendix",async()=>{
  const input=fixture(),context=await grounded();const output=buildTool("candidacy",input,{}, {},context);
  expect(output.text).toMatch(/(?:introduction|tell me about yourself)[^\n]*\n/i);const introduction=output.text.split(/why (?:this )?company/i)[0];expect(introduction).toMatch(/I supported the SQL migration\.|I wrote the rollback checklist\./);expect(introduction).toContain(input.jobTitle);expect(output.text).toMatch(/why (?:this )?company\s*[:\n]/i);expect(output.text).toMatch(/why (?:this )?role[^\n]*[:\n]/i);
  expect(output.text).toContain("offline scheduling");expect(output.text).toContain("rollback checklist");expect(output.text).toContain(input.roleMotivation);expect(output.claimEvidence.length).toBeGreaterThan(0);
 });
 it("sample answers address their actual question and repair targets the selected weak answer without rewriting it",async()=>{
  const input=fixture(),context=await grounded();const original={question:"What did you personally own in the migration?",answer:"We improved everything by17% and I solely led it."};const second={question:"Why this company?",answer:"I want a job."};
  const sample=buildTool("sample",input,{originalAnswer:original},{},context),motivation=buildTool("sample",input,{originalAnswer:second},{},context);expect(sample.text).not.toBe(motivation.text);expect(sample.text).toMatch(/rollback checklist|personal|owned/i);expect(motivation.text).toMatch(/offline scheduling|continuity during outages/);
  const repair=buildTool("repairSuggestion",input,{originalAnswer:original},{},context),otherRepair=buildTool("repairSuggestion",input,{originalAnswer:second},{},context);expect(repair.text).not.toBe(otherRepair.text);expect(repair.text).toMatch(/17%|ownership|solely|unsupported|personal contribution/i);expect(original.answer).toBe("We improved everything by17% and I solely led it.");expect(original.question).toBe("What did you personally own in the migration?");
 });
 it("reference and follow-up never promote an unconfirmed personal body by appending valid source quotes",async()=>{
  const context=await grounded(),input=fixture();input.examples=[{title:"Unconfirmed",context:"",responsibility:"I solely led forty migrations.",decision:"",action:"I reduced downtime by17%.",result:"17%",learning:"",verified:false}];const drafts={candidacy:{draft:"I solely led forty migrations and reduced downtime by17%."},questions:{draft:"What matters most?"}};
  for(const stage of ["reference","followup"]){const output=buildTool(stage,input,{},drafts,context);const body=output.text.split(/CANDIDATE SOURCE BASIS|SOURCE CLAIMS|EVIDENCE/i)[0];if(/I solely led forty|I reduced downtime by17%/.test(body)){expect(output.groundingStatus).not.toBe("linked");expect(output.missing.join(" ")).toMatch(/unconfirmed|unsupported|confirm.*experience/i);expect(output.claimEvidence.some(claim=>/solely led forty|reduced downtime by17%/.test(claim.quote))).toBe(false);}if(stage==="followup"){expect(output.text).toContain("I supported the SQL migration.");expect(output.text).toMatch(/offline scheduling|continuity during outages/);}else expect(output.text).toMatch(/rollback checklist|supported the (?:SQL )?migration/);expect(output.contextId).toBe(context.id);}
 });});
