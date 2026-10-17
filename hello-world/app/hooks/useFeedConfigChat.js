"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {mergeConversationConfig} from "@/lib/feedConfig/conversation";

export function useFeedConfigChat({onApplied,onReload,accountId}={}) {
 const [status,setStatus]=useState("idle"),[draft,setDraft]=useState(null),[history,setHistory]=useState([]),[error,setError]=useState(""),[saved,setSaved]=useState(null),[uncertain,setUncertain]=useState(false),[omitted,setOmitted]=useState(false),[reconciled,setReconciled]=useState(false);
 const epoch=useRef(0),lock=useRef(false),controller=useRef(null),draftRef=useRef(null),historyRef=useRef([]),callbacks=useRef({onApplied,onReload});
 useLayoutEffect(()=>{callbacks.current={onApplied,onReload};},[onApplied,onReload]);
 useEffect(()=>()=>{epoch.current++;controller.current?.abort();},[accountId]);
 const replace=useCallback(value=>{draftRef.current=value;setDraft(value);},[]);
 const reset=useCallback((initial=null)=>{if(lock.current||(uncertain&&!reconciled))return;epoch.current++;controller.current?.abort();historyRef.current=[];setHistory([]);replace(initial?mergeConversationConfig(initial):null);setSaved(null);setError("");setUncertain(false);setReconciled(false);setOmitted(false);setStatus("idle");},[replace,uncertain,reconciled]);
 const updateDraft=useCallback((field,value)=>{if(lock.current||uncertain)return;replace(mergeConversationConfig(draftRef.current||{}, {[field]:value,...(field==="tailoringDocumentMode"?{needsDocumentChoice:false}:{})}));setSaved(null);},[replace,uncertain]);
 const sendMessage=useCallback(async message=>{
  if(lock.current||uncertain||!accountId||!message.trim()||message.trim().length>2000)return;
  lock.current=true;const token=++epoch.current;controller.current=new AbortController();setStatus("loading");setError("");
  try {
   const res=await fetch("/api/feed-config/chat",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.current.signal,body:JSON.stringify({message:message.trim(),history:historyRef.current,currentConfig:draftRef.current||{}})});
   const body=await res.json();if(token!==epoch.current)return;
   if(!res.ok){setStatus(res.status===429?"limited":"error");setError(res.status===401?"Sign in to configure searches.":res.status===429?"Too many messages. Try again shortly.":"Could not propose this configuration. Please retry.");return;}
   replace(mergeConversationConfig(body.config));setSaved(null);
   const turns=[...historyRef.current,{role:"user",content:message.trim()},{role:"assistant",content:((body.mode==="fallback"?"Fallback proposal: ":body.mode==="embedded"?"Offline proposal: ":"")+String(body.assistantMessage||"Review the proposed configuration below.")).slice(0,2000)}];
   let total=turns.reduce((n,t)=>n+t.content.length,0);while(turns.length>12||total>12000){total-=turns.shift().content.length;setOmitted(true);}historyRef.current=turns;setHistory(turns);setStatus("idle");
  }catch{if(token===epoch.current){setStatus("error");setError("Could not reach the configuration service. Please retry.");}}
  finally{if(token===epoch.current)lock.current=false;}
 },[accountId,replace,uncertain]);
 const accept=useCallback(async()=>{
  if(lock.current||uncertain||!accountId||!draftRef.current||draftRef.current.needsDocumentChoice)return;
  lock.current=true;const token=++epoch.current;controller.current=new AbortController();setStatus("saving");setError("");
  try{
   const res=await fetch("/api/feed-config/apply",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.current.signal,body:JSON.stringify(draftRef.current)});const body=await res.json();if(token!==epoch.current)return;
   if(!res.ok){setStatus("error");setError(body.code==="DOCUMENT_MODE_SCHEMA_REQUIRED"?"Document selection needs server setup. Your draft is retained.":"Could not save this search. Your draft is retained.");return;}
   if(!body.search?.id)throw new Error("Uncertain save");setSaved(body.search);setStatus("idle");callbacks.current.onApplied?.(body.search);
  }catch{if(token===epoch.current){setUncertain(true);setStatus("uncertain");setError("The save outcome is uncertain. Reload saved searches and inspect them before creating another copy.");}}
  finally{if(token===epoch.current)lock.current=false;}
 },[accountId,uncertain]);
 const reconcile=useCallback(async()=>{
  if(lock.current)return;lock.current=true;const token=++epoch.current;setStatus("saving");
  try{const res=await fetch("/api/saved-searches");const body=await res.json();if(token!==epoch.current)return;if(!res.ok)throw new Error("reload");callbacks.current.onReload?.(body.searches||[]);setReconciled(true);setStatus("uncertain");setError("Saved searches reloaded. Inspect the list, then reopen the saved search or start a new proposal deliberately.");}catch{if(token===epoch.current){setStatus("uncertain");setError("Unable to reload saved searches. Retry the reload before creating another copy.");}}finally{if(token===epoch.current)lock.current=false;}
 },[]);
 return {status,draft,history,error,saved,uncertain,omitted,reconciled,sendMessage,accept,reset,reconcile,
 setJobKeywords:v=>updateDraft("jobKeywords",v),setMaxYearsExp:v=>updateDraft("maxYearsExp",v),setSelectedCategories:v=>updateDraft("selectedCategories",v),setSelectedCompanies:v=>updateDraft("selectedCompanies",v),setExcludedCompanies:v=>updateDraft("excludedCompanies",v),setExcludedTitleKeywords:v=>updateDraft("excludedTitleKeywords",v),setAutoTailorMinIntervalMinutes:v=>updateDraft("autoTailorMinIntervalMinutes",v),setEmailOnNewJobs:v=>updateDraft("emailOnNewJobs",v),setTailoringDocumentMode:v=>updateDraft("tailoringDocumentMode",v)};
}
