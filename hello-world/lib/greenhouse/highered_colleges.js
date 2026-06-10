// Higher-education / education-sector employers with VERIFIED live Greenhouse
// job boards. Each slug below was confirmed against the live Greenhouse API
// (https://boards-api.greenhouse.io/v1/boards/{slug}/jobs) and returns a real
// board with active postings.
//
// NOTE: Very few traditional universities publish a public Greenhouse board —
// most use Workday/Interfolio/PageUp. The boards that DO exist in this sector
// are online-learning / edtech employers, many of which post part-time
// instructor, contractor "technical mentor", curriculum, and faculty-style
// roles (e.g. Udacity, General Assembly, Outschool). Adjunct/instructor
// seekers should target these via saved-search keywords like
// "instructor", "adjunct", "faculty", "lecturer", "mentor", "part-time".
//
// Each entry: { slug, name, categories: ["Higher Education"] }
export const HIGHERED_GREENHOUSE_COMPANIES = [
  { slug: "2u", name: "2U", categories: ["Higher Education"] },
  { slug: "clever", name: "Clever", categories: ["Higher Education"] },
  { slug: "coursera", name: "Coursera", categories: ["Higher Education"] },
  { slug: "datacamp", name: "DataCamp", categories: ["Higher Education"] },
  { slug: "degreed", name: "Degreed", categories: ["Higher Education"] },
  { slug: "duolingo", name: "Duolingo", categories: ["Higher Education"] },
  { slug: "edmentum", name: "Edmentum", categories: ["Higher Education"] },
  { slug: "generalassembly", name: "General Assembly", categories: ["Higher Education"] },
  { slug: "guild", name: "Guild", categories: ["Higher Education"] },
  { slug: "ixllearning", name: "IXL Learning", categories: ["Higher Education"] },
  { slug: "khanacademy", name: "Khan Academy", categories: ["Higher Education"] },
  { slug: "masterclass", name: "MasterClass", categories: ["Higher Education"] },
  { slug: "nerdy", name: "Nerdy (Varsity Tutors)", categories: ["Higher Education"] },
  { slug: "newsela", name: "Newsela", categories: ["Higher Education"] },
  { slug: "outschool", name: "Outschool", categories: ["Higher Education"] },
  { slug: "pathstream", name: "Pathstream", categories: ["Higher Education"] },
  { slug: "springboard", name: "Springboard", categories: ["Higher Education"] },
  { slug: "udacity", name: "Udacity", categories: ["Higher Education"] },
  { slug: "udemy", name: "Udemy", categories: ["Higher Education"] },
];
