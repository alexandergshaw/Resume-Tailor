"use client";
import {useState} from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
export default function FeedConfigChat({onSend,status,history=[],error="",omitted=false,disabled=false}) {
 const [message,setMessage]=useState("");const busy=status==="loading"||status==="saving"||disabled;
 function send(){const text=message.trim();if(!text||text.length>2000||busy)return;onSend(text);setMessage("");}
 return <Box>
  <Box role="log" aria-label="Search setup conversation" aria-live="polite" aria-relevant="additions" sx={{maxHeight:360,overflowY:"auto",display:"flex",flexDirection:"column",gap:1,mb:2}}>
   {history.map((turn,i)=><Box key={i} sx={{alignSelf:turn.role==="user"?"flex-end":"flex-start",bgcolor:turn.role==="user"?"action.selected":"background.paper",border:"1px solid",borderColor:"divider",p:1.5,borderRadius:2,maxWidth:"90%"}}><Typography fontWeight={600}>{turn.role==="user"?"You":"Setup assistant"}</Typography><Typography sx={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{turn.content}</Typography></Box>)}
  </Box>
  {omitted&&<Typography variant="caption">Older turns omitted from context; your current reviewed configuration is retained.</Typography>}
  <TextField fullWidth multiline minRows={3} label="Describe jobs, check frequency and documents" placeholder="Track remote platform roles, check every 2 hours, and tailor my resume only." value={message} disabled={busy} inputProps={{maxLength:2000}} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}}/>
  <Button onClick={send} disabled={busy||!message.trim()} sx={{mt:1}}>Send message</Button>
  <Typography role="status" aria-live="polite">{status==="loading"?"Preparing your proposal…":status==="saving"?"Saving…":""}</Typography>
  {error&&<Typography role="alert" color="error">{error}</Typography>}
 </Box>;
}
