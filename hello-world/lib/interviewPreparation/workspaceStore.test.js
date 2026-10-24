import { describe, it, expect } from "vitest";
import { workspaceKey, createWorkspace, loadWorkspace, saveWorkspace, serializeWorkspace } from "./workspaceStore";
function memory(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: (key) => values.delete(key) };
}
describe("N176 workspace storage boundaries", () => {
  it("isolates account, application, guest and delimiter-bearing identities", () => {
    const keys = [workspaceKey("A","X"),workspaceKey("A","Y"),workspaceKey("B","X"),workspaceKey(null,"X"),workspaceKey("A",null),workspaceKey("A:X","Y"),workspaceKey("A","X:Y")];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(key => key.startsWith("interview-preparation:v1:"))).toBe(true);
  });
  it("does not confuse missing, corrupt and incompatible saved data or overwrite it on load", () => {
    const key = workspaceKey("A","X");
    const storage = memory();
    expect(loadWorkspace(storage,key).workspace).toBeTruthy();
    expect(storage.values.has(key)).toBe(false);
    for (const raw of ["{broken", JSON.stringify({version:999}), "null", "[]"]) {
      storage.setItem(key,raw);
      const result = loadWorkspace(storage,key);
      expect(result.error).toBeTruthy();
      expect(result.corrupt).toBeTruthy();
      expect(storage.getItem(key)).toBe(raw);
    }
  });
  it("reports inaccessible storage without throwing", () => {
    const storage = { getItem() { throw new Error("storage blocked"); }, setItem() { throw new Error("quota exceeded"); } };
    expect(loadWorkspace(storage,"key").error).toMatch(/storage|blocked|save|read|available/i);
    const result = saveWorkspace(storage,"key",createWorkspace());
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
  it("can save and serialize a valid workspace without crossing another key", () => {
    const storage = memory();
    const a = workspaceKey("A","X"), b = workspaceKey("B","X");
    storage.setItem(b,"OTHER ACCOUNT SENTINEL");
    const value = createWorkspace();
    expect(saveWorkspace(storage,a,value).ok).toBe(true);
    const loaded = loadWorkspace(storage,a);
    expect(loaded.error).toBeFalsy();
    expect(loaded.workspace).toEqual(JSON.parse(serializeWorkspace(value)));
    expect(storage.getItem(b)).toBe("OTHER ACCOUNT SENTINEL");
    expect(serializeWorkspace(value)).not.toContain("OTHER ACCOUNT SENTINEL");
  });
});

describe("N176 stored content validation and recovery", () => {
  it("roundtrips edited drafts, input basis, ranked questions, sources and previous answers", () => {
    const storage=memory(), key=workspaceKey("A","application-X"), value=createWorkspace();
    value.inputs.company="Cedar Transit Tools";
    value.inputs.interestReasons="resilient public-service tools";
    value.artifacts.questions={draft:"2. EDITED SECOND?\n1. TOP QUESTION?",basis:"original input basis",suggestion:null};
    value.artifacts.candidacy={draft:"MY EDITED INTRO",basis:"saved basis",suggestion:{text:"unaccepted alternative",basis:"alternative input basis"}};
    value.sources.articles=[{title:"Pilot",url:"https://example.org/pilot",summary:"pilot in two cities",date:""}];
    value.attempts=[{id:"attempt-1",question:"What did you own?",answer:"I owned the rollback plan.",seconds:65,review:{checks:{directness:3,specificity:3,ownership:2,relevance:3,brevity:3},heuristic:{score:50,verdict:"Needs clearer ownership",strengths:["Relevant example"],improvements:["Clarify personal contribution"],missing:["Observed outcome"],star:{situation:true,task:true,action:true,result:false},delivery:[],source:"embedded"},seconds:65,reviewedAt:"2026-11-01T10:00:00.000Z",label:"Heuristic typed-text review"},previousAnswer:"We planned it."}];
    value.revision=5;
    expect(saveWorkspace(storage,key,value).ok).toBe(true);
    expect(loadWorkspace(storage,key).workspace).toEqual(value);
  });
  it("rejects wrong nested types, oversized fields and unbounded histories without changing storage", () => {
    const storage=memory({key:"KEEP ORIGINAL"});
    const wrong=createWorkspace(); wrong.inputs.resume=[];
    const huge=createWorkspace(); huge.inputs.resume="x".repeat(600000);
    const history=createWorkspace(); history.attempts=Array.from({length:100},(_,i)=>({id:String(i),answer:"a",question:"q"}));
    const fact=createWorkspace(); fact.inputs.facts=[{text:"not a complete source record"}];
    for(const candidate of [wrong,huge,history,fact]) {
      const result=saveWorkspace(storage,"key",candidate); expect(result.ok).toBe(false); expect(result.error).toBeTruthy(); expect(storage.getItem("key")).toBe("KEEP ORIGINAL");
    }
  });
  it("retrying after quota recovery writes the retained draft", () => {
    const storage=memory(), value=createWorkspace(); value.inputs.background="MY UNSAVED EDIT";
    const original=storage.setItem;
    storage.setItem=()=>{throw new Error("quota exceeded");};
    expect(saveWorkspace(storage,"key",value).ok).toBe(false); expect(value.inputs.background).toBe("MY UNSAVED EDIT");
    storage.setItem=original;
    expect(saveWorkspace(storage,"key",value).ok).toBe(true); expect(loadWorkspace(storage,"key").workspace.inputs.background).toBe("MY UNSAVED EDIT");
  });
});

describe("N176 nested persisted render inputs",()=>{
  const invalidCases=[
    ["null article",value=>{value.sources.articles=[null];}],
    ["non-record article",value=>{value.sources.articles=["not an article"]; }],
    ["wrong article title type",value=>{value.sources.articles=[{title:[],summary:"public pilot",url:"https://example.org/pilot",date:""}];}],
    ["wrong article summary type",value=>{value.sources.articles=[{title:"Pilot",summary:{text:"not text"},url:"https://example.org/pilot",date:""}];}],
    ["non-record review",value=>{value.attempts=[{id:"a",question:"What did you own?",answer:"I owned rollback.",review:"not a review"}];}],
    ["review without heuristic",value=>{value.attempts=[{id:"a",question:"What did you own?",answer:"I owned rollback.",review:{checks:{ownership:2}}}];}],
    ["review with malformed heuristic",value=>{value.attempts=[{id:"a",question:"What did you own?",answer:"I owned rollback.",review:{heuristic:"not a heuristic",checks:{ownership:2}}}];}],
    ["review with malformed improvements",value=>{value.attempts=[{id:"a",question:"What did you own?",answer:"I owned rollback.",review:{heuristic:{score:50,verdict:"Review",improvements:{}},checks:{ownership:2}}}];}],
  ];
  it.each(invalidCases)("rejects %s with a recoverable read diagnostic and keeps original bytes",(_name,mutate)=>{
    const value=createWorkspace();mutate(value);const raw=JSON.stringify(value),storage=memory({key:raw});
    const result=loadWorkspace(storage,"key");expect(result.corrupt).toBe(true);expect(result.error).toBeTruthy();expect(storage.getItem("key")).toBe(raw);
    const saved=saveWorkspace(storage,"key",value);expect(saved.ok).toBe(false);expect(saved.error).toBeTruthy();expect(storage.getItem("key")).toBe(raw);
  });
  it("accepts a complete renderable article and reviewed attempt as positive control",()=>{
    const value=createWorkspace();value.sources.articles=[{id:"pilot",title:"Pilot announcement",source:"Employer",date:"2026-09-01",url:"https://example.org/pilot",summary:"pilot in two cities",suggestion:"Ask how this affects the role"}];
    value.attempts=[{id:"a",question:"What did you own?",answer:"I owned the rollback plan.",seconds:65,review:{heuristic:{score:50,verdict:"Clarify outcomes",strengths:["Personal ownership stated"],improvements:["Add an observed result"],missing:["Observed outcome"],star:{situation:true,task:true,action:true,result:false},delivery:[],source:"embedded"},checks:{directness:3,specificity:3,ownership:2,relevance:3,brevity:3},seconds:65,reviewedAt:"2026-11-01T10:00:00.000Z",label:"Heuristic typed-text review"}}];
    const storage=memory();expect(saveWorkspace(storage,"key",value).ok).toBe(true);const result=loadWorkspace(storage,"key");expect(result.error).toBeFalsy();expect(result.corrupt).toBe(false);expect(result.workspace).toEqual(value);
  });
});

describe("N176 additive grounded workspace schema",()=>{
 it("migrates valid legacy drafts as unlinked without inventing source or review provenance",()=>{const old=createWorkspace();delete old.candidate;delete old.reviewHistory;old.artifacts.candidacy={draft:"LEGACY USER DRAFT",suggestion:null,acceptedBasis:"old basis"};const storage=memory({key:JSON.stringify(old)}),result=loadWorkspace(storage,"key");expect(result.error).toBeFalsy();expect(result.workspace.artifacts.candidacy.draft).toBe("LEGACY USER DRAFT");expect(result.workspace.candidate.contextId).toBeNull();expect(result.workspace.reviewHistory).toEqual([]);expect(result.workspace.artifacts.candidacy.contextId??null).toBeNull();expect(serializeWorkspace(result.workspace)).not.toContain("trustedInvocationId");});
 it("rejects malformed newly persisted source and review structures with original bytes preserved",()=>{const cases=[value=>{value.candidate={contextId:42,sourceMode:"application",supplements:[]};},value=>{value.candidate={contextId:null,sourceMode:null,supplements:[null]};},value=>{value.reviewHistory=[null];},value=>{value.artifacts.candidacy={draft:"original",version:1,contextId:null,claimEvidence:[{start:0,end:1,quote:"wrong",evidenceIds:[42]}],history:[]};}];for(const mutate of cases){const value=createWorkspace();mutate(value);const raw=JSON.stringify(value),storage=memory({key:raw}),result=loadWorkspace(storage,"key");expect(result.corrupt).toBe(true);expect(result.error).toBeTruthy();expect(storage.getItem("key")).toBe(raw);}});
});

it("rejects malformed nested saved semantic findings without granting historical data a current receipt",()=>{
 for(const review of [{status:"clean",coveredDraftIds:["candidacy"],findings:[null],probes:[]},{status:"advisory",coveredDraftIds:["candidacy"],findings:[],probes:[null]}]){const value=createWorkspace();value.reviewHistory=[{schemaVersion:1,contextId:"sha256:context",bundleId:"sha256:bundle",host:{invocationId:"historical",authorContextId:"author",reviewerContextId:"reviewer",role:"adversarial-reviewer",provider:"gemini",separateInvocation:true},review}];const raw=JSON.stringify(value),storage=memory({key:raw});expect(loadWorkspace(storage,"key").corrupt).toBe(true);expect(storage.getItem("key")).toBe(raw);}
});

it("roundtrips actual structured findings and source/draft locators in both saved review histories",async()=>{
 const {createCandidateContext,sha256}=await import("./candidateContext");const {createReviewTarget,validateReviewResult}=await import("./reviewContract");const r="I wrote the rollback checklist.",c="I supported the migration lead.";const doc=async(kind,text)=>({kind,state:"ready",origin:"manual-user-supplied",documentId:null,contentIdentity:`sha256:${await sha256(text)}`,text,createdAt:null,error:null});const context=await createCandidateContext({snapshot:{accountId:"A",applicationId:null,mode:"manual",status:"ready",resume:await doc("resume",r),cover:await doc("cover",c),observedAt:"2026-10-23",consistency:"manual-captured",historicalStrength:{resume:null,cover:null}},job:{title:"Engineer",company:"Cedar",description:"Plan migrations."},requestedStrength:{aggressiveness:3,tailorMode:""}});const e=context.evidence.find(value=>value.sourceKind==="resume"),bundle=[{id:"candidacy",kind:"candidacy",version:1,text:e.quote,claimEvidence:[{start:0,end:e.quote.length,quote:e.quote,evidenceIds:[e.id]}]}],target=await createReviewTarget(context,bundle);const raw={status:"advisory",coveredDraftIds:["candidacy"],findings:[{id:"framing-1",severity:"advice",category:"framing",reason:"Lead with your supported contribution",recommendation:"Put the rollback checklist first",drafts:[{draftId:"candidacy",start:0,end:e.quote.length,quote:e.quote}],sources:[{evidenceId:e.id,quote:e.quote}],missingEvidence:null}],probes:[{draftId:"candidacy",question:"Why did you choose that checklist?"}]};const checked=validateReviewResult(raw,{context,bundle});expect(checked.ok).toBe(true);const envelope={schemaVersion:1,contextId:context.id,bundleId:target.bundleId,host:{invocationId:"historical-invocation",authorContextId:target.authorContextId,reviewerContextId:"distinct-reviewer",role:"adversarial-reviewer",provider:"gemini",requestedModel:"configured-model",observedModel:null,separateInvocation:true,createdAt:"2026-10-23T18:30:00Z"},review:checked.value};const value=createWorkspace();value.reviewHistory=[envelope];value.reviewAttempts=[{status:"reviewed",at:"2026-10-23T18:30:00Z",error:"",envelope}];const storage=memory();expect(saveWorkspace(storage,"key",value).ok).toBe(true);const loaded=loadWorkspace(storage,"key");expect(loaded.error).toBeFalsy();expect(loaded.workspace.reviewHistory[0].review.findings[0].drafts[0].quote).toBe(e.quote);expect(loaded.workspace.reviewAttempts[0].envelope).toEqual(envelope);expect(serializeWorkspace(loaded.workspace)).not.toContain("trustedInvocationId");
});

function researchFixture(){return {version:1,applicationId:"app-A",selectionKey:"sha256:"+"b".repeat(64),contextKey:"sha256:"+"a".repeat(64),company:"Cedar Transit Tools",title:"Reliability Manager",location:"Cheyenne",researchedAt:"2026-10-24T03:00:00.000Z",status:"ready",narrative:"Employer process unknown.",sources:[{id:"source-1",url:"https://cedar.example/careers",title:"Employer careers"}],spans:[{start:0,end:8,sourceId:"source-1"}],stages:[{id:"stage-1",rank:1,name:"Role conversation",purpose:"Discuss reliability",type:"prediction",questions:Array.from({length:5},(_,i)=>({id:`stage-1-question-${i+1}`,rank:i+1,text:`Cedar scenario ${i+1}?`,reason:`Role duty ${i+1} motivates this prediction.`,type:"prediction"}))}],unknowns:["Actual process unknown"],coverage:{searched:true,truncated:false,acceptedSources:1,rejectedCitations:0,warnings:[],descriptionTruncated:false},provider:{name:"gemini",model:null}};}
function completeResearchWorkspace(){const value=createWorkspace(),r=researchFixture();value.research={adopted:r,pending:{...r,researchedAt:"2026-10-25T03:00:00Z"},previous:{...r,researchedAt:"2026-10-23T03:00:00Z"},overrides:{"stage-1-question-1":"EXACT USER EDIT — rollback at Cedar?"},selection:"stage-1"};value.practiceQueue=[{id:"stage-1-question-1",questionId:"stage-1-question-1",stageId:"stage-1",stageName:"Role conversation",text:"EXACT USER EDIT — rollback at Cedar?",originalQuestion:"Cedar scenario 1?",sourceContextKey:r.contextKey}];value.rehearsalDraft={question:value.practiceQueue[0].text,text:"EXACT UNSAVED TRANSCRIPT",revision:"EXACT UNSAVED REVISION",sourceContextKey:r.contextKey,stageId:"stage-1",questionId:"stage-1-question-1",elapsedSeconds:13};value.attempts=[{id:"old-answer",question:"Cedar scenario 1?",answer:"ORIGINAL ANSWER",seconds:7,review:null,sourceContextKey:r.contextKey,stageId:"stage-1",questionId:"stage-1-question-1",originalQuestion:"Cedar scenario 1?"}];return value;}
describe("N180 strict optional research/queue/draft storage and legacy recovery",()=>{
 it("roundtrips adopted pending previous overrides queue and unsaved draft without crossing account/application",()=>{const value=completeResearchWorkspace(),storage=memory(),key=workspaceKey("A","app-A"),other=workspaceKey("B","app-A");storage.setItem(other,"OTHER ACCOUNT RAW SENTINEL");expect(saveWorkspace(storage,key,value).ok).toBe(true);const read=loadWorkspace(storage,key);expect(read.error).toBeFalsy();expect(read.workspace).toEqual(value);expect(storage.getItem(other)).toBe("OTHER ACCOUNT RAW SENTINEL");expect(loadWorkspace(storage,workspaceKey("A","app-B")).workspace.research.adopted).toBeNull();expect(read.workspace.research.adopted.stages[0].questions[0].text).toBe("Cedar scenario 1?");expect(read.workspace.research.overrides["stage-1-question-1"]).toBe("EXACT USER EDIT — rollback at Cedar?");});
 it("loads legacy v1 without new optional fields and preserves preexisting content",()=>{const legacy=createWorkspace();delete legacy.research;delete legacy.practiceQueue;delete legacy.rehearsalDraft;legacy.inputs.background="LEGACY ORIGINAL";legacy.attempts=[{id:"old",question:"Old question?",answer:"OLD ANSWER",seconds:2,review:null}];const raw=JSON.stringify(legacy),storage=memory({key:raw});const read=loadWorkspace(storage,"key");expect(read.error).toBeFalsy();expect(read.workspace.inputs.background).toBe("LEGACY ORIGINAL");expect(read.workspace.attempts).toEqual(legacy.attempts);expect(read.workspace.research).toEqual({adopted:null,pending:null,previous:null,overrides:{},selection:null});expect(read.workspace.practiceQueue).toEqual([]);expect(read.workspace.rehearsalDraft).toBeNull();expect(storage.getItem("key")).toBe(raw);});
 it.each([
  ["reported question",v=>{v.research.adopted.stages[0].questions[0].type="reported";}],
  ["unknown override",v=>{v.research.overrides.unknown="NOT AN ADOPTED QUESTION";}],
  ["oversized override",v=>{v.research.overrides["stage-1-question-1"]="x".repeat(601);}],
  ["unknown span source",v=>{v.research.adopted.spans[0].sourceId="missing";}],
  ["out of narrative span",v=>{v.research.adopted.spans[0].end=10000;}],
  ["excess queue",v=>{v.practiceQueue=Array.from({length:31},()=>({...v.practiceQueue[0]}));}],
  ["queue wrong text type",v=>{v.practiceQueue[0].text=[];}],
  ["negative elapsed",v=>{v.rehearsalDraft.elapsedSeconds=-1;}],
  ["draft wrong revision type",v=>{v.rehearsalDraft.revision={text:"not text"};}],
  ["invalid attempt source metadata",v=>{v.attempts[0].questionId=[];}],
  ["unknown research field",v=>{v.research.hiddenTrust=true;}],
  ["null optional record",v=>{v.research=null;}]
 ])("refuses %s and preserves exact original corrupt recovery bytes",(_name,mutate)=>{const value=completeResearchWorkspace();mutate(value);const raw=JSON.stringify(value),storage=memory({key:raw});const read=loadWorkspace(storage,"key");expect(read.corrupt).toBe(true);expect(read.error).toBeTruthy();expect(storage.getItem("key")).toBe(raw);const write=saveWorkspace(storage,"key",value);expect(write.ok).toBe(false);expect(storage.getItem("key")).toBe(raw);});
 it("retains complete new edits through quota failure and writes on explicit recovery",()=>{const value=completeResearchWorkspace(),storage=memory({key:"ORIGINAL STORED RAW"}),original=storage.setItem;storage.setItem=()=>{throw new Error("quota exceeded");};expect(saveWorkspace(storage,"key",value).ok).toBe(false);expect(value.rehearsalDraft.text).toBe("EXACT UNSAVED TRANSCRIPT");expect(storage.getItem("key")).toBe("ORIGINAL STORED RAW");storage.setItem=original;expect(saveWorkspace(storage,"key",value).ok).toBe(true);expect(loadWorkspace(storage,"key").workspace).toEqual(value);});
});

it("S2 accepts complete draft identities, retains legacy omissions and rejects invalid identity types/bounds",()=>{const value=completeResearchWorkspace();value.rehearsalDraft.originalQuestion="DISTINCT ORIGINAL PREDICTION?";value.rehearsalDraft.targetAttemptId="old-answer";const storage=memory();expect(saveWorkspace(storage,"key",value).ok).toBe(true);expect(loadWorkspace(storage,"key").workspace.rehearsalDraft).toEqual(value.rehearsalDraft);for(const mutate of [draft=>{draft.originalQuestion=[];},draft=>{draft.originalQuestion="x".repeat(601);},draft=>{draft.targetAttemptId=4;},draft=>{draft.targetAttemptId="x".repeat(201);}]){const bad=JSON.parse(JSON.stringify(value));mutate(bad.rehearsalDraft);const raw=JSON.stringify(bad),badStorage=memory({key:raw});expect(loadWorkspace(badStorage,"key").corrupt).toBe(true);expect(badStorage.getItem("key")).toBe(raw);}delete value.rehearsalDraft.originalQuestion;delete value.rehearsalDraft.targetAttemptId;expect(saveWorkspace(storage,"legacy",value).ok).toBe(true);expect(loadWorkspace(storage,"legacy").error).toBeFalsy();});
