"use client";
import {useRef,useState} from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";

export default function FeedConfigChat({onSend,status,history=[],error="",omitted=false,disabled=false}) {
 const [message,setMessage]=useState("");const composer=useRef(null);const busy=status==="loading"||status==="saving"||disabled;
 function send(){const text=message.trim();if(!text||text.length>2000||busy)return;onSend(text);setMessage("");}
 function prefill(text){if(busy)return;setMessage(text);composer.current?.focus();}
 return <Box sx={{minWidth:0}}>
  {history.length===0&&<Box sx={{py:{xs:2,sm:4},mb:3}}><AutoAwesomeOutlinedIcon aria-hidden="true" sx={{color:"primary.main",fontSize:30,mb:2}}/><Typography variant="h5" fontWeight={650} sx={{mb:1,letterSpacing:"-.025em"}}>What would you like to find?</Typography><Typography color="text.secondary" sx={{lineHeight:1.8,maxWidth:460,mb:3}}>Start with a role, a place or a preference. You can adjust every detail before saving.</Typography><Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>{[["Remote platform roles","Find remote platform engineering roles."],["Check every 2 hours","Check every 2 hours."],["Tailor my resume only","Tailor my resume only."]].map(([label,text])=><Button key={label} size="small" variant="outlined" disabled={busy} onClick={()=>prefill(text)} sx={{borderColor:"divider",borderRadius:5,textTransform:"none",px:1.5,py:.8,whiteSpace:"normal",textAlign:"left"}}>{label}</Button>)}</Box></Box>}
  <Box role="log" aria-label="Search setup conversation" aria-live="polite" aria-relevant="additions" sx={{maxHeight:520,overflowY:"auto",display:"flex",flexDirection:"column",gap:2.5,mb:history.length?3:0,minWidth:0}}>
   {history.map((turn,i)=><Box key={i} sx={{alignSelf:turn.role==="user"?"flex-end":"flex-start",width:"fit-content",maxWidth:"94%",minWidth:0}}><Typography variant="caption" color="text.secondary" sx={{display:"block",mb:.75,px:.5,fontWeight:650}}>{turn.role==="user"?"You":"Setup assistant"}</Typography><Box sx={{bgcolor:turn.role==="user"?"action.selected":"background.default",border:"1px solid",borderColor:"divider",p:2,borderRadius:3}}><Typography variant="body2" sx={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",lineHeight:1.85}}>{turn.content}</Typography></Box></Box>)}
  </Box>
  {omitted&&<Typography variant="caption" color="text.secondary" sx={{display:"block",mb:1.5}}>Older turns omitted from context; your current reviewed configuration is retained.</Typography>}
  <Box sx={{p:1.5,border:"1px solid",borderColor:busy?"divider":"primary.main",borderRadius:3,bgcolor:"background.default",minWidth:0}}>
   <TextField fullWidth multiline minRows={3} maxRows={8} label="Describe jobs, check frequency and documents" placeholder="For example: remote platform roles, every 2 hours, resume only…" value={message} disabled={busy} inputRef={composer} inputProps={{maxLength:2000}} InputLabelProps={{shrink:true}} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}} sx={{"& .MuiOutlinedInput-notchedOutline":{border:0},"& .MuiInputBase-root":{px:.5},"& .MuiInputLabel-root":{position:"static",transform:"none",mb:1,fontSize:".78rem",whiteSpace:"normal",maxWidth:"100%"},"& textarea":{fontSize:".9rem",lineHeight:1.7}}}/>
   <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:1,flexWrap:"wrap",mt:1}}><Typography variant="caption" color="text.secondary">{message.length}/2000 · Ctrl/Cmd + Enter to send</Typography><Button variant="contained" endIcon={<SendOutlinedIcon/>} onClick={send} disabled={busy||!message.trim()||message.trim().length>2000} sx={{textTransform:"none",borderRadius:2,px:2}}>Send message</Button></Box>
  </Box>
  <Typography role="status" aria-live="polite" variant="body2" color="text.secondary" sx={{mt:1,minHeight:20}}>{status==="loading"?"Preparing your proposal…":status==="saving"?"Saving…":""}</Typography>
  {error&&<Box role="alert" sx={{p:1.5,mt:1,border:"1px solid",borderColor:"error.main",borderRadius:2}}><Typography variant="body2" color="error">{error}</Typography></Box>}
 </Box>;
}
