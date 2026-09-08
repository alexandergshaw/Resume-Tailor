// The Live Feed filter panel's two derived values: the removable "currently
// applied filter" summary chips, and the count beside the toolbar's Filters
// toggle.
//
// Both moved out of LiveFeedTab.js verbatim for two reasons. The first is that
// they ARE pure -- each reads the same two plain objects, and the setters
// `onDelete` closes over are supplied by the caller -- so a unit test can
// exercise every branch without mounting a component that owns four fetches
// and two intervals. The second is a hard constraint: lib/feed/
// liveFeedWiring.test.js asserts LiveFeedTab.js stays under 900 lines, and the
// mobile filter-sheet work needed the room. Behaviour is unchanged from the
// inline versions; filterChips.test.js pins both.
//
// `onDelete` closes over the CALLER's setters rather than mutating anything
// here, so this module never needs to know how the filters are stored.

import { REMOTE_LABELS, SINCE_LABELS, companyName } from "./liveFeedClient.js";

// The number beside the toolbar's "Filters" toggle. Deliberately NOT
// `buildFilterChips(...).length`: a chip is emitted per keyword, per category
// and per company, while this counts each of those LISTS as one active filter,
// so a search with eight keywords reads as one filter rather than eight. The
// two numbers are different on purpose and must stay that way.
export function countActiveFilters({ filters, advanced }) {
  let n = 0;
  if (advanced.jobKeywords?.length) n += 1;
  if (advanced.maxYearsExp && advanced.maxYearsExp !== "any") n += 1;
  if (advanced.selectedCategories?.length) n += 1;
  if (advanced.selectedCompanies?.length) n += 1;
  if (advanced.excludedCompanies?.length) n += 1;
  if (advanced.excludedTitleKeywords?.length) n += 1;
  if (filters.q) n += 1;
  if (filters.location) n += 1;
  if (filters.remote) n += 1;
  if (filters.since) n += 1;
  return n;
}

export function buildFilterChips({
  filters,
  advanced,
  updateFilter,
  setMaxYearsExp,
  setJobKeywords,
  setSelectedCategories,
  setSelectedCompanies,
  setExcludedCompanies,
  setExcludedTitleKeywords,
}) {
  const chips = [];
  if (filters.q) {
    chips.push({ key: "q", label: `“${filters.q}”`, onDelete: () => updateFilter("q", "") });
  }
  if (filters.location) {
    chips.push({ key: "location", label: filters.location, onDelete: () => updateFilter("location", "") });
  }
  if (filters.remote) {
    chips.push({
      key: "remote",
      label: REMOTE_LABELS[filters.remote] || filters.remote,
      onDelete: () => updateFilter("remote", ""),
    });
  }
  if (filters.since) {
    chips.push({
      key: "since",
      label: SINCE_LABELS[filters.since] || `Since ${filters.since}d`,
      onDelete: () => updateFilter("since", ""),
    });
  }
  if (advanced.maxYearsExp && advanced.maxYearsExp !== "any") {
    chips.push({
      key: "maxYears",
      label: `≤ ${advanced.maxYearsExp} yrs`,
      onDelete: () => setMaxYearsExp("any"),
    });
  }
  (advanced.jobKeywords || []).forEach((kw) => {
    chips.push({
      key: `kw:${kw}`,
      label: kw,
      onDelete: () => setJobKeywords((advanced.jobKeywords || []).filter((k) => k !== kw)),
    });
  });
  (advanced.selectedCategories || []).forEach((cat) => {
    chips.push({
      key: `cat:${cat}`,
      label: cat,
      onDelete: () => setSelectedCategories((advanced.selectedCategories || []).filter((c) => c !== cat)),
    });
  });
  (advanced.selectedCompanies || []).forEach((co) => {
    const name = companyName(co);
    chips.push({
      key: `co:${name}`,
      label: name,
      onDelete: () =>
        setSelectedCompanies((advanced.selectedCompanies || []).filter((c) => companyName(c) !== name)),
    });
  });
  (advanced.excludedCompanies || []).forEach((co) => {
    const name = companyName(co);
    chips.push({
      key: `exco:${name}`,
      label: `Exclude: ${name}`,
      onDelete: () =>
        setExcludedCompanies((advanced.excludedCompanies || []).filter((c) => companyName(c) !== name)),
    });
  });
  (advanced.excludedTitleKeywords || []).forEach((kw) => {
    chips.push({
      key: `exkw:${kw}`,
      label: `Exclude: ${kw}`,
      onDelete: () =>
        setExcludedTitleKeywords((advanced.excludedTitleKeywords || []).filter((k) => k !== kw)),
    });
  });
  return chips;
}
