"use client";
import {useId} from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import FeedConfigChat from "./FeedConfigChat";
import DerivedConfigReview from "./DerivedConfigReview";
import {useFeedConfigChat} from "@/app/hooks/useFeedConfigChat";
import {rowToSavedSearchEntry} from "@/lib/feed/savedSearchEntry";

export default function FeedConfigPanel({currentUser,savedSearches=[],setSavedSearches,onOpenAutomation,GREENHOUSE_COMPANIES=[],COMPANY_CATEGORIES=[]}) {
 const savedLabelId=useId();
 const chat=useFeedConfigChat({accountId:currentUser?.id,onApplied:row=>setSavedSearches?.(prev=>[rowToSavedSearchEntry(row),...prev.filter(x=>x.id!==row.id)]),onReload:rows=>setSavedSearches?.(rows.map(rowToSavedSearchEntry))});
 if(!currentUser)return <Typography>Sign in to set up searches.</Typography>;
 const busy=chat.status==="loading"||chat.status==="saving";
 const contextDisabled=busy||(chat.uncertain&&!chat.reconciled);
 return <Box sx={{maxWidth:1280,mx:"auto",py:{xs:1,md:3},px:{xs:0,sm:1},minWidth:0}}>
  <Box sx={{display:"flex",alignItems:"flex-start",gap:2,mb:3}}>
   <Box sx={{p:1.25,borderRadius:3,bgcolor:"action.selected",color:"primary.main",display:{xs:"none",sm:"flex"}}}><AutoAwesomeOutlinedIcon aria-hidden="true"/></Box>
   <Box sx={{minWidth:0}}><Typography variant="overline" color="text.secondary" sx={{letterSpacing:2}}>YOUR NEXT OPPORTUNITY</Typography><Typography variant="h4" sx={{fontSize:{xs:"1.7rem",md:"2.1rem"},fontWeight:700,letterSpacing:"-.04em",mb:1}}>Set up your search, together.</Typography><Typography color="text.secondary" sx={{maxWidth:680,lineHeight:1.7}}>Tell us what a good fit looks like. Refine the details in conversation, then review and save your search.</Typography></Box>
  </Box>
  <Box sx={{display:"flex",gap:1.5,flexWrap:"wrap",alignItems:"center",mb:3,p:1.5,border:"1px solid",borderColor:"divider",borderRadius:3,bgcolor:"background.paper",minWidth:0}}>
   <Button variant="outlined" startIcon={<AddIcon/>} disabled={contextDisabled} onClick={()=>chat.reset()} sx={{textTransform:"none",flexShrink:0}}>Start new proposal</Button>
   <FormControl size="small" sx={{flex:"1 1 240px",minWidth:0,maxWidth:{xs:"100%",md:400}}} disabled={contextDisabled}>
    <InputLabel id={savedLabelId} shrink>Start from a saved search</InputLabel>
    <Select labelId={savedLabelId} label="Start from a saved search" displayEmpty value="" onChange={e=>{const entry=savedSearches.find(x=>x.id===e.target.value);if(entry)chat.reset(entry);}} sx={{minWidth:0,"& .MuiSelect-select":{overflow:"hidden",textOverflow:"ellipsis"}}}>
     <MenuItem value="">Choose a search to copy</MenuItem>{savedSearches.map(x=><MenuItem key={x.id} value={x.id} sx={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{x.name}</MenuItem>)}
    </Select>
   </FormControl>
   <Typography variant="caption" color="text.secondary" sx={{ml:{lg:"auto"}}}>A proposal first. Always your call.</Typography>
  </Box>
  <Box data-testid="setup-workspace" sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",lg:"minmax(0,1.3fr) minmax(340px,1fr)"},gap:3,alignItems:"start",minWidth:0}}>
   <Box component="section" aria-label="Search conversation" sx={{minWidth:0,bgcolor:"background.paper",border:"1px solid",borderColor:"divider",borderRadius:4,overflowWrap:"anywhere"}}>
    <Box sx={{display:"flex",justifyContent:"space-between",gap:1,alignItems:"center",px:{xs:2,sm:3},py:2,borderBottom:"1px solid",borderColor:"divider"}}><Typography fontWeight={700}>Your conversation</Typography><Chip size="small" variant="outlined" label="Setup assistant"/></Box>
    <Box sx={{p:{xs:2,sm:3}}}><FeedConfigChat onSend={chat.sendMessage} status={chat.status} history={chat.history} error={chat.error} omitted={chat.omitted} disabled={chat.uncertain}/></Box>
    {chat.uncertain&&<Box sx={{px:3,pb:3}}><Button variant="outlined" onClick={chat.reconcile} disabled={busy}>Reload saved searches to reconcile</Button></Box>}
    <Typography variant="caption" color="text.secondary" sx={{display:"block",px:3,pb:2}}>Unsaved conversation is cleared on page reload. Saving never turns on automatic tailoring.</Typography>
   </Box>
   <Box component="aside" aria-label="Search proposal" sx={{minWidth:0}}>
    {chat.saved&&<Box role="status" sx={{p:2,mb:2,bgcolor:"action.selected",borderRadius:3,border:"1px solid",borderColor:"divider"}}><Typography fontWeight={700}>Saved search {chat.saved.name||chat.saved.id}.</Typography><Button size="small" onClick={onOpenAutomation}>Open Automation</Button></Box>}
    {chat.draft?<DerivedConfigReview {...chat} onAccept={chat.accept} disabled={busy||chat.uncertain} GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES} COMPANY_CATEGORIES={COMPANY_CATEGORIES}/>:<Box sx={{border:"1px solid",borderColor:"divider",borderRadius:4,bgcolor:"background.paper",p:{xs:2,sm:3},minHeight:320}}><Chip label="Your proposal" size="small" variant="outlined" sx={{mb:3}}/><Typography variant="h6" fontWeight={700} sx={{mb:1}}>The details come together here.</Typography><Typography color="text.secondary" sx={{lineHeight:1.8,mb:3}}>As you chat, we’ll build an editable search with the jobs, check frequency and documents you choose.</Typography>{["Job preferences","Schedule & alerts","Documents to tailor"].map((label,i)=><Box key={label} sx={{display:"flex",alignItems:"center",gap:1.5,py:1.5,borderTop:"1px solid",borderColor:"divider"}}><Typography variant="caption" color="text.secondary">0{i+1}</Typography><Typography variant="body2">{label}</Typography></Box>)}<Typography variant="caption" color="text.secondary" sx={{display:"block",mt:3}}>Nothing is saved until you review and confirm.</Typography></Box>}
   </Box>
  </Box>
 </Box>;
}
