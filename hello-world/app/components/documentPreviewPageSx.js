// A page-like surface so the preview reads like the printed document. The
// "paper" stays white with dark ink in both themes (it mirrors a printed
// page). Extracted out of DocumentPreviewDialog.js (N69 S5) to keep that
// file under its own line ceiling -- imported there as the read-only/edit-
// mode page style; nothing about the object itself changed.
const pageSx = {
  bgcolor: "var(--paper-bg)",
  color: "var(--paper-ink)",
  fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
  fontSize: "11pt",
  lineHeight: 1.3,
  px: { xs: 2, sm: 5 },
  py: { xs: 2.5, sm: 4 },
  mx: "auto",
  maxWidth: 720,
  minHeight: 360,
  border: "1px solid var(--border)",
  borderRadius: 1,
  boxShadow: "0 1px 6px rgba(0,0,0,0.10)",
  "& p": { margin: 0 },
  "& h1": { fontSize: "16pt", fontWeight: 700, margin: "8pt 0 3pt" },
  "& h2": { fontSize: "13pt", fontWeight: 700, margin: "7pt 0 2pt" },
  "& h3": { fontSize: "11.5pt", fontWeight: 700, margin: "5pt 0 2pt" },
  "& ul, & ol": { margin: "3pt 0", paddingLeft: "1.5em" },
  "& li": { margin: "1pt 0" },
};

export default pageSx;
