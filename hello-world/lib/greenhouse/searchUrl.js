// Builds the /api/greenhouse search URL for one saved search. Extracted from
// app/page.js (a line-capped component) with its logic unchanged; only the
// saved-search pre-warmer there calls it.
//
//   query      the keyword string
//   companies  a mix of company objects ({ slug }) and plain name strings: objects
//              travel as one `companies=` slug list, strings as `companyName=`
//              parameters, so a company the app does not know still searches
export function buildGreenhouseSearchUrl(query, companies) {
  let params = "";
  const list = Array.isArray(companies) ? companies : [];
  if (list.length > 0) {
    const slugs = list.filter((c) => typeof c !== "string").map((c) => c.slug);
    const names = list.filter((c) => typeof c === "string");
    if (slugs.length > 0) params += `&companies=${slugs.join(",")}`;
    if (names.length > 0) params += names.map((n) => `&companyName=${encodeURIComponent(n)}`).join("");
  }
  return `/api/greenhouse?query=${encodeURIComponent(query)}${params}`;
}
