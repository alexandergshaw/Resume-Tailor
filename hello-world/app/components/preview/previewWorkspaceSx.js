// Workspace geometry is separate from printed document typography/export styling.
const workspaceSx = {
  paper: {
    height: { xs: "100dvh", sm: "calc(100dvh - 32px)" },
    maxHeight: { xs: "100dvh", sm: "calc(100dvh - 32px)" },
    m: { xs: 0, sm: 2 },
    width: { xs: "100%", sm: "calc(100% - 32px)" },
    borderRadius: { xs: 0, sm: 3 },
    overflow: "hidden",
    "& > *": { flexShrink: 0 },
    "& > .MuiBox-root:not([data-testid=document-navigation])": { maxHeight: "18dvh", overflowY: "auto" },
    "& > .MuiDialogContent-root": { flex: "1 1 0", minHeight: 0 },
    "& > [data-copy-status=chip]": { px: 2, fontSize: "0.75rem", minHeight: 18, maxHeight: 60, overflowY: "auto" },
  },
  title: {
    px: { xs: 2, sm: 2.5 }, py: 1.25, pr: 6,
    position: "relative", fontSize: { xs: "1.05rem", sm: "1.2rem" },
    lineHeight: 1.4, bgcolor: "var(--bg-surface)",
  },
  context: {
    display: "block", fontSize: "0.75rem", fontWeight: 400,
    color: "var(--text-secondary)", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  navigation: {
    px: { xs: 1.25, sm: 2.5 }, bgcolor: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)", minWidth: 0,
  },
  tabs: {
    minHeight: 40, width: "100%", "& .MuiTab-root": { minWidth: { xs: 88, sm: 110 } },
  },
  modeRow: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1,
    minHeight: 44, pb: 0.5, borderTop: "1px solid var(--border)",
  },
  content: {
    bgcolor: "var(--surface-2)", px: { xs: 1, sm: 3 }, py: 1.5,
    overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
    "& > [data-testid=document-context]": { mb: 1.5, minWidth: 0 },
  },
  revision: {
    mt: 2, pb: 1.5, bgcolor: "var(--bg-surface)",
    border: "1px solid var(--border)", borderRadius: 2,
  },
  actions: {
    flexWrap: "wrap", gap: { xs: 0.75, sm: 1 },
    px: { xs: 1.25, sm: 2.5 }, py: 1,
    bgcolor: "var(--bg-surface)", borderTop: "1px solid var(--border)",
    maxHeight: "32dvh", overflowY: "auto", alignItems: "center",
    "& > :not(style) ~ :not(style)": { ml: 0 },
  },
};

export default workspaceSx;
