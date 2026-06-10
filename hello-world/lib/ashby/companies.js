// Education / edtech employers with VERIFIED live Ashby job boards.
// Each slug confirmed against the live Ashby API
// (https://api.ashbyhq.com/posting-api/job-board/{slug}) returning >=1 job.
//
// `campus` (Campus.edu, an online community college) and `primer` post real
// teaching/instructor roles; the rest are education-sector employers whose
// postings flow through the same filtering as every other source.
//
// Each entry: { slug, name, categories: ["Higher Education"] }
export const ASHBY_COMPANIES = [
  { slug: "campus", name: "Campus", categories: ["Higher Education"] },
  { slug: "primer", name: "Primer", categories: ["Higher Education"] },
  { slug: "preply", name: "Preply", categories: ["Higher Education"] },
  { slug: "handshake", name: "Handshake", categories: ["Higher Education"] },
  { slug: "speak", name: "Speak", categories: ["Higher Education"] },
  { slug: "multiverse", name: "Multiverse", categories: ["Higher Education"] },
  { slug: "cambly", name: "Cambly", categories: ["Higher Education"] },
  { slug: "magicschool", name: "MagicSchool", categories: ["Higher Education"] },
  { slug: "edia", name: "Edia", categories: ["Higher Education"] },
  { slug: "ello", name: "Ello", categories: ["Higher Education"] },
  { slug: "maven", name: "Maven", categories: ["Higher Education"] },
];
