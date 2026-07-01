"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import EntityTab from "./library/EntityTab";
import ProfileTab from "./library/ProfileTab";
import PreviewTab from "./library/PreviewTab";
import ImportDialog from "./library/ImportDialog";
import {
  TAXONOMY_SCHEMA,
  FOCUS_SCHEMA,
  SKILLGROUP_SCHEMA,
  CONTENT_SCHEMA,
  TABS,
} from "./library/schemas";

export default function LibraryEditor() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      if (res.status === 401) {
        setError("Please sign in to manage your tailoring library.");
        setData(null);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load library.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the library once on mount (the canonical fetch-on-mount pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  if (loading) return <Box sx={{ p: 4, textAlign: "center" }}><CircularProgress /></Box>;
  if (error && !data) return <Box sx={{ p: 4 }}><Alert severity="info">{error}</Alert></Box>;

  const categories = data?.categories || [];

  return (
    <Box sx={{ width: "100%", maxWidth: 1080, minWidth: 0, mx: "auto", p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3, justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" } }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Tailoring Library</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            The terms, focus areas, and skills the engine uses. Changes apply on your next tailoring run.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => setImportOpen(true)} sx={{ flexShrink: 0, alignSelf: { xs: "flex-start", sm: "center" }, whiteSpace: "nowrap", textTransform: "none", borderRadius: 1.5 }}>
          Import from posting
        </Button>
      </Stack>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 3,
          minHeight: 40,
          borderBottom: "1px solid var(--border)",
          "& .MuiTab-root": { minHeight: 40, textTransform: "none", fontSize: 14, fontWeight: 500, px: 2, minWidth: 0 },
          "& .MuiTabs-indicator": { height: 2 },
        }}
      >
        {TABS.map((t) => (
          <Tab
            key={t.label}
            label={<Tooltip title={t.help} arrow enterTouchDelay={0} placement="bottom"><span>{t.label}</span></Tooltip>}
          />
        ))}
      </Tabs>

      {tab === 0 && <EntityTab title="Buzzword" description="The taxonomy: canonical terms, their categories, and the aliases matched in postings." rows={data.taxonomy} schema={TAXONOMY_SCHEMA(categories)} endpoint="/api/library/taxonomy" categories={categories} onChanged={reload} />}
      {tab === 1 && <EntityTab title="Focus Area" description="When a posting's match terms clear the threshold, this area drives the framing." rows={data.focusAreas} schema={FOCUS_SCHEMA} endpoint="/api/library/focus-areas" onChanged={reload} />}
      {tab === 2 && <EntityTab title="Skill Group" description="Your skills, grouped. Conditional groups only surface when the posting asks for them." rows={data.skillGroups} schema={SKILLGROUP_SCHEMA} endpoint="/api/library/skill-groups" onChanged={reload} />}
      {tab === 3 && <EntityTab title="Fragment" description="Tagged accomplishment/bullet fragments the engine slots into the résumé." rows={data.contentLibrary} schema={CONTENT_SCHEMA} endpoint="/api/library/content-library" onChanged={reload} />}
      {tab === 4 && <ProfileTab key={data.profile?.updated_at || "profile"} profile={data.profile} onChanged={reload} />}
      {tab === 5 && <PreviewTab />}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onChanged={reload} />
    </Box>
  );
}
