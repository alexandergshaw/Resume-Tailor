"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Badge from "@mui/material/Badge";
import RefreshIcon from "@mui/icons-material/Refresh";
import TuneIcon from "@mui/icons-material/Tune";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

// The TabHeader `actions` block for the Live Feed: refresh, the freshness
// dot + text, the source-health chip, the Feed/Queue toggle, the Filters
// button and the Autofill-profile button. Extracted out of LiveFeedTab.js as
// MARKUP only -- every value here (freshnessText, failureCount, counts) is
// still computed in LiveFeedTab.js via the shared lib/feed/liveFeedClient
// helpers and handed down as a prop.
export default function FeedToolbar({
  refreshing,
  onRefresh,
  hasUpdated,
  isStale,
  freshnessText,
  failureCount,
  view,
  onChangeView,
  queueCount,
  activeFilterCount,
  advancedOpen,
  onToggleAdvanced,
  currentUser,
  onOpenAutofillProfile,
}) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
      {/* The span exists so the tooltip still shows while the button is
          disabled (refreshing), but MUI's Tooltip labels its DIRECT child --
          the span -- so without an explicit aria-label here the button
          itself is announced as nothing at all. Same defect and same fix as
          FeedPostingCard.js's four controls. */}
      <Tooltip title="Refresh now">
        <span>
          <IconButton
            onClick={onRefresh}
            disabled={refreshing}
            size="small"
            color="primary"
            aria-label="Refresh now"
          >
            {refreshing ? <CircularProgress size={18} /> : <RefreshIcon />}
          </IconButton>
        </span>
      </Tooltip>

      {/* Freshness indicator dot. Colour is never the only signal here --
          freshnessText below carries the same information in words
          (WCAG 1.4.1); the dot is a glanceable reinforcement of it. */}
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: !hasUpdated ? "grey.400" : isStale ? "warning.main" : "success.main",
          boxShadow: (theme) =>
            !hasUpdated
              ? "none"
              : `0 0 0 3px ${isStale ? "var(--warning-soft)" : "var(--success-soft)"}`,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {freshnessText}
      </Typography>

      {failureCount > 0 && (
        // describeChild: without it MUI stamps the title onto the Chip as
        // aria-label, overriding its visible "N src errors" text (WCAG
        // 2.5.3) -- the Chip has no aria-label of its own to win that fight
        // the way FeedPostingCard.js's buttons do. describeChild makes the
        // title an aria-describedby instead, leaving the visible text as
        // the name.
        <Tooltip title={`${failureCount} source(s) failed on the last ingest`} describeChild>
          <Chip size="small" color="warning" variant="outlined" label={`${failureCount} src errors`} />
        </Tooltip>
      )}

      {/* Feed vs. Auto-Apply Queue toggle */}
      <Box
        sx={{
          display: "inline-flex",
          borderRadius: 1.5,
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <Button
          size="small"
          disableElevation
          variant={view === "feed" ? "contained" : "text"}
          color={view === "feed" ? "primary" : "inherit"}
          onClick={() => onChangeView("feed")}
          sx={{ textTransform: "none", fontWeight: 600, borderRadius: 0, px: 1.75 }}
        >
          Feed
        </Button>
        <Button
          size="small"
          disableElevation
          variant={view === "queue" ? "contained" : "text"}
          color={view === "queue" ? "primary" : "inherit"}
          onClick={() => onChangeView("queue")}
          sx={{ textTransform: "none", fontWeight: 600, borderRadius: 0, px: 1.75 }}
        >
          <Badge
            badgeContent={queueCount}
            color="secondary"
            sx={{ "& .MuiBadge-badge": { right: -10, top: -2 } }}
          >
            Queue
          </Badge>
        </Button>
      </Box>

      <Badge
        badgeContent={activeFilterCount}
        color="primary"
        overlap="rectangular"
        sx={{ "& .MuiBadge-badge": { right: 4, top: 4 } }}
      >
        <Button
          size="small"
          variant={advancedOpen || activeFilterCount > 0 ? "contained" : "outlined"}
          color={activeFilterCount > 0 ? "primary" : "inherit"}
          disableElevation
          startIcon={<TuneIcon />}
          endIcon={advancedOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          onClick={onToggleAdvanced}
          sx={{ textTransform: "none", fontWeight: 600, px: 1.75 }}
        >
          Filters
        </Button>
      </Badge>

      {currentUser && (
        // describeChild: without it MUI stamps the title onto the Button as
        // aria-label, overriding its visible "Autofill profile" text (WCAG
        // 2.5.3) -- a voice-control user saying what they see could not
        // activate it. describeChild makes the title an aria-describedby
        // (verified against the installed MUI version in
        // node_modules/@mui/material/Tooltip/Tooltip.js) instead of an
        // aria-label, leaving the visible text as the name.
        <Tooltip
          title="Edit the profile used by Auto Fill and get your bookmarklet"
          describeChild
        >
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disableElevation
            onClick={onOpenAutofillProfile}
            sx={{ textTransform: "none", fontWeight: 600, px: 1.75 }}
          >
            Autofill profile
          </Button>
        </Tooltip>
      )}
    </Box>
  );
}
