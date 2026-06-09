"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";

// Shared job-filter controls used by both the Job Search subtab and the Live
// Feed tab. Purely presentational: all state lives in the parent. Keeping this
// in one place ensures the two tabs never drift apart.
//
// The Categories control auto-populates Companies from the selected categories,
// matching the original Job Search behavior.
export default function JobFilterControls({
  jobKeywords,
  setJobKeywords,
  maxYearsExp,
  setMaxYearsExp,
  selectedCategories,
  setSelectedCategories,
  selectedCompanies,
  setSelectedCompanies,
  excludedCompanies,
  setExcludedCompanies,
  excludedTitleKeywords,
  setExcludedTitleKeywords,
  GREENHOUSE_COMPANIES,
  COMPANY_CATEGORIES,
}) {
  const dedupeStrings = (values) => {
    const cleaned = values
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const v of cleaned) {
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  };

  return (
    <>
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={jobKeywords}
        onChange={(_, newValue) => setJobKeywords(dedupeStrings(newValue))}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Job title or keywords"
            placeholder={
              jobKeywords.length === 0
                ? "e.g. react, frontend, typescript (press Enter to add)"
                : ""
            }
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
          ))
        }
      />
      <FormControl size="small" sx={{ minWidth: 150, alignSelf: "flex-start" }}>
        <InputLabel>Experience</InputLabel>
        <Select
          label="Experience"
          value={maxYearsExp}
          onChange={(e) => { setMaxYearsExp(e.target.value); }}
        >
          <MenuItem value="any">Any experience</MenuItem>
          <MenuItem value="0">Entry level (0 yrs)</MenuItem>
          <MenuItem value="1">Up to 1 yr</MenuItem>
          <MenuItem value="2">Up to 2 yrs</MenuItem>
          <MenuItem value="3">Up to 3 yrs</MenuItem>
          <MenuItem value="5">Up to 5 yrs</MenuItem>
          <MenuItem value="7">Up to 7 yrs</MenuItem>
          <MenuItem value="10">Up to 10 yrs</MenuItem>
        </Select>
      </FormControl>
      <Autocomplete
        multiple
        options={COMPANY_CATEGORIES}
        value={selectedCategories}
        onChange={(_, newValue) => {
          setSelectedCategories(newValue);
          const matched =
            newValue.length === 0
              ? []
              : GREENHOUSE_COMPANIES.filter((c) =>
                  c.categories.some((cat) => newValue.includes(cat))
                );
          setSelectedCompanies(matched);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Categories"
            placeholder={selectedCategories.length === 0 ? "All categories" : ""}
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
          ))
        }
      />
      <Autocomplete
        multiple
        freeSolo
        options={GREENHOUSE_COMPANIES}
        getOptionLabel={(option) => typeof option === "string" ? option : option.name}
        value={selectedCompanies}
        onChange={(_, newValue) => {
          setSelectedCompanies(
            newValue.map((entry) => {
              if (typeof entry === "string") {
                const match = GREENHOUSE_COMPANIES.find((c) => c.name.toLowerCase() === entry.toLowerCase());
                return match || entry;
              }
              return entry;
            })
          );
        }}
        isOptionEqualToValue={(option, value) => {
          if (typeof option === "string" || typeof value === "string") return option === value;
          return option.slug === value.slug;
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Companies"
            placeholder={selectedCompanies.length === 0 ? "All Greenhouse companies" : ""}
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => {
            const label = typeof option === "string" ? option : option.name;
            return <Chip key={label} label={label} size="small" {...getTagProps({ index })} />;
          })
        }
      />
      <Autocomplete
        multiple
        options={GREENHOUSE_COMPANIES}
        getOptionLabel={(option) => option.name}
        value={excludedCompanies}
        onChange={(_, newValue) => { setExcludedCompanies(newValue); }}
        isOptionEqualToValue={(option, value) => option.slug === value.slug}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Exclude Companies"
            placeholder={excludedCompanies.length === 0 ? "Hide companies from results" : ""}
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip key={option.slug} label={option.name} size="small" {...getTagProps({ index })} />
          ))
        }
      />
      <Autocomplete
        multiple
        freeSolo
        options={[]}
        value={excludedTitleKeywords}
        onChange={(_, newValue) => setExcludedTitleKeywords(dedupeStrings(newValue))}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Exclude title keywords"
            placeholder={
              excludedTitleKeywords.length === 0
                ? "e.g. senior, manager, sales (press Enter to add)"
                : ""
            }
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
          ))
        }
      />
    </>
  );
}
