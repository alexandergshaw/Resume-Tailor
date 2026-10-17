"use client";

import { useId } from "react";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Divider from "@mui/material/Divider";
import JobFilterControls from "../JobFilterControls";
import CadenceControl from "./CadenceControl";

// N60 second chunk, Step D (AC2-C1, AC2-C2, AC2-C4c review half). Shows a
// chat turn's derived configuration field by field, in the SAME vocabulary
// the existing saved-search surface uses -- JobFilterControls (imported, not
// forked, so the chat surface can never drift from the chip surface) for
// every filter field, the shared CadenceControl for "frequency", and the
// FeedAutomationCard alert-Switch idiom for email. Every field is editable in
// place; nothing is written until Accept.
//
// Deliberately NO auto-tailor enable control here (AC2-C3): enabling stays
// behind FeedAutomationCard's own cost-stating confirm, on a saved search
// that already exists -- a chat turn can propose a search, never switch on
// unattended spend.
//
// excludedCompanies is the one field whose stored shape (a string[] of
// company names, per the deriver's own contract) does not match what the
// shared control's non-freeSolo Autocomplete expects (GREENHOUSE_COMPANIES
// objects) -- the two small helpers below convert at the boundary so the
// draft itself, and the apply body built from it, stay plain strings the
// sanitizer's sanitizeStringArray actually understands.
function namesToCompanyOptions(names, catalog) {
  return (names || [])
    .map((name) => {
      if (typeof name !== "string") return name;
      return (catalog || []).find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
    })
    .filter(Boolean);
}
function companyOptionsToNames(values) {
  return (values || []).map((value) => (typeof value === "string" ? value : value.name));
}

export default function DerivedConfigReview({
  draft,
  setJobKeywords,
  setMaxYearsExp,
  setSelectedCategories,
  setSelectedCompanies,
  setExcludedCompanies,
  setExcludedTitleKeywords,
  setAutoTailorMinIntervalMinutes,
  setEmailOnNewJobs,
  onAccept,
  setTailoringDocumentMode,
  disabled = false,
  saved = null,
  GREENHOUSE_COMPANIES,
  COMPANY_CATEGORIES,
}) {
  const documentsLabelId = useId();
  return (
    <Box sx={{ p: {xs:2,sm:3}, border: "1px solid", borderColor: "divider", borderRadius: 4, bgcolor:"background.paper",minWidth:0,overflowWrap:"anywhere" }}>
      <Box sx={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:1,mb:2}}><Typography variant="overline" color="text.secondary" sx={{letterSpacing:1.5}}>YOUR SEARCH</Typography><Chip size="small" label={saved?"Saved":"Proposed"} color={saved?"success":"default"} variant="outlined"/></Box>
      <Typography variant="h6" sx={{ mb: 1,fontWeight:700,letterSpacing:"-.02em",lineHeight:1.4 }}>
        {draft.name || "New automation"}
      </Typography>
      <Typography sx={{ color: "text.secondary", fontSize: "0.82rem", mb: 3,lineHeight:1.7 }}>
        {saved ? "Saved. Further changes create a new search copy." : "Proposed: review before saving a new search. Automatic tailoring remains off."}
      </Typography>
      <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <Typography variant="subtitle2" sx={{mb:2,fontWeight:700}}>Job preferences</Typography>
      <Box sx={{display:"grid",gap:2.5,minWidth:0,"& > *":{minWidth:0,maxWidth:"100%"},"& .MuiFormControl-root":{width:"100%",minWidth:"0 !important"},"& .MuiInputLabel-outlined":{position:"static",transform:"none",maxWidth:"100%",whiteSpace:"normal",mb:.75,fontSize:".78rem"},"& .MuiOutlinedInput-notchedOutline legend":{maxWidth:"0.01px"},"& .MuiInputBase-root":{mt:"0 !important"}}}>
      <JobFilterControls
        jobKeywords={draft.jobKeywords}
        setJobKeywords={setJobKeywords}
        maxYearsExp={draft.maxYearsExp}
        setMaxYearsExp={setMaxYearsExp}
        selectedCategories={draft.selectedCategories}
        setSelectedCategories={setSelectedCategories}
        selectedCompanies={draft.selectedCompanies}
        setSelectedCompanies={setSelectedCompanies}
        excludedCompanies={namesToCompanyOptions(draft.excludedCompanies, GREENHOUSE_COMPANIES)}
        setExcludedCompanies={(values) => setExcludedCompanies(companyOptionsToNames(values))}
        excludedTitleKeywords={draft.excludedTitleKeywords}
        setExcludedTitleKeywords={setExcludedTitleKeywords}
        GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
        COMPANY_CATEGORIES={COMPANY_CATEGORIES}
      />
      </Box>
      <Divider sx={{my:3}}/>
      <Typography variant="subtitle2" sx={{mb:1,fontWeight:700}}>Schedule &amp; alerts</Typography>
      <Box sx={{minWidth:0,"& .MuiFormControl-root":{width:"100%",minWidth:"0 !important"},"& .MuiInputLabel-outlined":{position:"static",transform:"none",maxWidth:"100%",whiteSpace:"normal",mb:.75,fontSize:".78rem"},"& .MuiOutlinedInput-notchedOutline legend":{maxWidth:"0.01px"}}}>
      <CadenceControl value={draft.autoTailorMinIntervalMinutes} onChange={setAutoTailorMinIntervalMinutes} />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!!draft.emailOnNewJobs}
            onChange={(e) => setEmailOnNewJobs(e.target.checked)}
          />
        }
        label={<Box sx={{ fontSize: "0.78rem" }}>Email me new jobs</Box>}
        sx={{ m: 0, mt: 1 }}
      />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{display:"block",lineHeight:1.8,mt:1.5}}>Checks follow the existing schedule: minimum 15 minutes, default 60. Email alerts follow the service&apos;s email schedule.</Typography>
      <Divider sx={{my:3}}/>
      <Typography variant="subtitle2" sx={{mb:2,fontWeight:700}}>Documents</Typography>
      <FormControl fullWidth size="small" disabled={disabled} sx={{minWidth:0,"& .MuiInputLabel-outlined":{position:"static",transform:"none",whiteSpace:"normal",maxWidth:"100%",mb:.75,fontSize:".78rem"},"& .MuiOutlinedInput-notchedOutline legend":{maxWidth:"0.01px"}}}>
        <InputLabel id={documentsLabelId} shrink>Documents to tailor</InputLabel>
        <Select displayEmpty labelId={documentsLabelId} label="Documents to tailor" value={draft.tailoringDocumentMode || ""} onChange={e=>setTailoringDocumentMode?.(e.target.value || null)} sx={{width:"100%",minWidth:0,"& .MuiSelect-select":{whiteSpace:"normal",overflowWrap:"anywhere",pr:4}}}>
          <MenuItem value="" sx={{whiteSpace:"normal"}}>Resume + cover letter if available (legacy)</MenuItem>
          <MenuItem value="resume_only">Resume only</MenuItem>
          <MenuItem value="resume_cover" sx={{whiteSpace:"normal"}}>Resume + cover letter (both required)</MenuItem>
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary" sx={{display:"block",mt:1,lineHeight:1.8}}>Resume is always included. Choose whether to tailor a cover letter too.</Typography>
      {draft.needsDocumentChoice&&<Typography role="alert">Cover-only is unavailable. Choose a supported document option before saving.</Typography>}
      </fieldset>
      <Divider sx={{ my: 3 }} />
      <Button fullWidth variant="contained" size="large" sx={{borderRadius:2,textTransform:"none",fontWeight:650}} disabled={disabled||!!draft.needsDocumentChoice||!!saved} onClick={onAccept}>
        Save new search
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{display:"block",mt:1.5,textAlign:"center",lineHeight:1.7}}>You can enable automatic tailoring separately in Automation.</Typography>
    </Box>
  );
}
