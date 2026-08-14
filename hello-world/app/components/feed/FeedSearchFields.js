"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

// The quick-search grid (title/company, location, work type, posted-since,
// sort) inside the advanced filters panel. Extracted out of LiveFeedTab.js as
// MARKUP only -- `filters` and `updateFilter` are still owned and persisted
// by LiveFeedTab.js.
export default function FeedSearchFields({ filters, updateFilter }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
        gap: 1.5,
      }}
    >
      <TextField
        size="small"
        fullWidth
        label="Search title or company"
        value={filters.q}
        onChange={(e) => updateFilter("q", e.target.value)}
      />
      <TextField
        size="small"
        fullWidth
        label="Location"
        value={filters.location}
        onChange={(e) => updateFilter("location", e.target.value)}
      />
      <FormControl size="small" fullWidth>
        <InputLabel>Work type</InputLabel>
        <Select label="Work type" value={filters.remote} onChange={(e) => updateFilter("remote", e.target.value)}>
          <MenuItem value="">Any</MenuItem>
          <MenuItem value="remote">Remote</MenuItem>
          <MenuItem value="hybrid">Hybrid</MenuItem>
          <MenuItem value="onsite">On-site</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth>
        <InputLabel>Posted</InputLabel>
        <Select label="Posted" value={filters.since} onChange={(e) => updateFilter("since", e.target.value)}>
          <MenuItem value="">Any time</MenuItem>
          <MenuItem value="1">Last 24h</MenuItem>
          <MenuItem value="3">Last 3 days</MenuItem>
          <MenuItem value="7">Last 7 days</MenuItem>
          <MenuItem value="30">Last 30 days</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth>
        <InputLabel>Sort</InputLabel>
        <Select label="Sort" value={filters.sort} onChange={(e) => updateFilter("sort", e.target.value)}>
          <MenuItem value="newest">Newest</MenuItem>
          <MenuItem value="relevance">Relevance</MenuItem>
          <MenuItem value="company">Company A–Z</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}
