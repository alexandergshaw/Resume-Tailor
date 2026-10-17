"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import FeedConfigChat from "./FeedConfigChat";
import DerivedConfigReview from "./DerivedConfigReview";
import {useFeedConfigChat} from "@/app/hooks/useFeedConfigChat";
import {rowToSavedSearchEntry} from "@/lib/feed/savedSearchEntry";
export default function FeedConfigPanel({currentUser,savedSearches=[],setSavedSearches,onOpenAutomation,GREENHOUSE_COMPANIES=[],COMPANY_CATEGORIES=[]}) {
 const chat=useFeedConfigChat({accountId:currentUser?.id,onApplied:row=>setSavedSearches?.(prev=>[rowToSavedSearchEntry(row),...prev.filter(x=>x.id!==row.id)]),onReload:rows=>setSavedSearches?.(rows.map(rowToSavedSearchEntry))});
 if(!currentUser)return <Typography>Sign in to set up searches.</Typography>;
 const busy=chat.status==="loading"||chat.status==="saving";
 return <Box sx={{maxWidth:960,mx:"auto",p:{xs:1,sm:2}}}>
  <Typography variant="h6">Setup chat</Typography><Typography color="text.secondary">Describe the jobs you want, refine your proposal, then save it. Unsaved conversation is cleared on page reload.</Typography>
  <Box sx={{display:"flex",gap:1,flexWrap:"wrap",my:2}}><Button disabled={busy||(chat.uncertain&&!chat.reconciled)} onClick={()=>chat.reset()}>Start new proposal</Button><label>Start from a saved search <select aria-label="Start from a saved search" disabled={busy||(chat.uncertain&&!chat.reconciled)} value="" onChange={e=>{const entry=savedSearches.find(x=>x.id===e.target.value);if(entry)chat.reset(entry);}}><option value="">Choose a search to copy</option>{savedSearches.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></Box>
  <FeedConfigChat onSend={chat.sendMessage} status={chat.status} history={chat.history} error={chat.error} omitted={chat.omitted} disabled={chat.uncertain}/>
  {chat.uncertain&&<Button onClick={chat.reconcile} disabled={busy}>Reload saved searches to reconcile</Button>}
  {chat.saved&&<Typography role="status">Saved search {chat.saved.name||chat.saved.id}. <Button onClick={onOpenAutomation}>Open Automation</Button></Typography>}
  {chat.draft&&<DerivedConfigReview {...chat} onAccept={chat.accept} disabled={busy||chat.uncertain} GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES} COMPANY_CATEGORIES={COMPANY_CATEGORIES}/>}
 </Box>;
}
