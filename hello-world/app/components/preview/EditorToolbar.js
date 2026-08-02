"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18];
// Block/paragraph styles for the header dropdown (execCommand formatBlock tags).
const BLOCK_STYLES = [
  { tag: "P", label: "Normal" },
  { tag: "H1", label: "Heading 1" },
  { tag: "H2", label: "Heading 2" },
  { tag: "H3", label: "Heading 3" },
];

// Format-toolbar buttons: bigger tap targets on phones, and never shrink so the
// bar stays a single swipeable row on narrow screens.
const fmtBtnSx = { minWidth: { xs: 40, sm: 36 }, minHeight: { xs: 40, sm: 32 }, flexShrink: 0 };
const fmtGapSx = { width: 8, flexShrink: 0 };

// The rich-text formatting toolbar shown above the editable surface in edit
// mode. Operates on the SAME contentEditable node and the SAME saved
// selection range as the orchestrator (DocumentPreviewDialog): `editorRef`
// and `restoreSelection` are passed down by reference/closure, not copied,
// so a dropdown that steals focus here restores the exact selection the
// orchestrator captured via its own saveSelection().
export default function EditorToolbar({ editorRef, tab, draftHtmlRef, scheduleAutoSave, restoreSelection }) {
  const exec = (command, value) => {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
    scheduleAutoSave();
  };

  const applyFontSize = (pt) => {
    editorRef.current?.focus();
    const sel = restoreSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const span = document.createElement("span");
      span.style.fontSize = `${pt}pt`;
      try {
        sel.getRangeAt(0).surroundContents(span);
      } catch {
        // Selection crosses element boundaries — fall back to wrapping the HTML.
        document.execCommand("insertHTML", false, `<span style="font-size:${pt}pt">${sel.toString()}</span>`);
      }
    }
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
    scheduleAutoSave();
  };

  // Turn the caret's block into a heading or normal paragraph. Restores the
  // selection first because the dropdown steals focus.
  const applyBlockFormat = (tag) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("formatBlock", false, tag);
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
    scheduleAutoSave();
  };

  return (
    <Box
      sx={{
        px: { xs: 1, sm: 2 },
        py: 0.75,
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        flexWrap: { xs: "nowrap", sm: "wrap" },
        overflowX: { xs: "auto", sm: "visible" },
        WebkitOverflowScrolling: "touch",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Tooltip title="Bold"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} sx={fmtBtnSx}><FormatBoldIcon fontSize="small" /></Button></Tooltip>
      <Tooltip title="Italic"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} sx={fmtBtnSx}><FormatItalicIcon fontSize="small" /></Button></Tooltip>
      <Tooltip title="Underline"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} sx={fmtBtnSx}><FormatUnderlinedIcon fontSize="small" /></Button></Tooltip>
      <Box sx={fmtGapSx} />
      <Tooltip title="Align left"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyLeft"); }} sx={fmtBtnSx}><FormatAlignLeftIcon fontSize="small" /></Button></Tooltip>
      <Tooltip title="Align center"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyCenter"); }} sx={fmtBtnSx}><FormatAlignCenterIcon fontSize="small" /></Button></Tooltip>
      <Tooltip title="Align right"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyRight"); }} sx={fmtBtnSx}><FormatAlignRightIcon fontSize="small" /></Button></Tooltip>
      <Box sx={fmtGapSx} />
      <Tooltip title="Bulleted list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }} sx={fmtBtnSx}><FormatListBulletedIcon fontSize="small" /></Button></Tooltip>
      <Tooltip title="Numbered list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }} sx={fmtBtnSx}><FormatListNumberedIcon fontSize="small" /></Button></Tooltip>
      <Box sx={fmtGapSx} />
      <Select
        size="small"
        displayEmpty
        value=""
        onChange={(e) => applyBlockFormat(e.target.value)}
        renderValue={() => "Style"}
        sx={{ height: { xs: 40, sm: 32 }, fontSize: "0.8rem", minWidth: 92, flexShrink: 0 }}
        MenuProps={{ disableAutoFocusItem: true }}
      >
        {BLOCK_STYLES.map((b) => (
          <MenuItem key={b.tag} value={b.tag}>{b.label}</MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        displayEmpty
        value=""
        onChange={(e) => applyFontSize(e.target.value)}
        renderValue={() => "Size"}
        sx={{ height: { xs: 40, sm: 32 }, fontSize: "0.8rem", minWidth: 76, flexShrink: 0 }}
        MenuProps={{ disableAutoFocusItem: true }}
      >
        {FONT_SIZES.map((pt) => (
          <MenuItem key={pt} value={pt}>{pt} pt</MenuItem>
        ))}
      </Select>
    </Box>
  );
}
