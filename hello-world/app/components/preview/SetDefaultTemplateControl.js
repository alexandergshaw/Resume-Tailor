"use client";

import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";

// N97: promotes the currently-shown document as the durable DEFAULT TEMPLATE
// for its kind (résumé or cover letter) -- reused to format future
// generations of that type. Mounted only for DOCX_SCOPES with an available
// document (DocumentPreviewDialog.js) -- structurally ABSENT on the email
// tab, since resume_templates.kind has no 'email' case (AC-1). Presentational
// only: capture/store logic lives in the onClick handler's owner.
export default function SetDefaultTemplateControl({ scope, disabled = false, onClick }) {
  return (
    <Tooltip title={`Use this ${scope === "cover" ? "cover letter" : "résumé"}'s formatting for future generations`}>
      <span>
        <Button
          data-testid="set-default-template-control"
          size="small"
          variant="outlined"
          startIcon={<BookmarkAddIcon fontSize="small" />}
          onClick={onClick}
          disabled={disabled}
          sx={{ textTransform: "none" }}
        >
          Set as default template
        </Button>
      </span>
    </Tooltip>
  );
}
