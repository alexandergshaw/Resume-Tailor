// The technology catalog: the map from a name a user writes on a project page
// to the public feeds (Atlassian Statuspage, OSV, CISA KEV, endoflife.date)
// that can say something about it. Every coordinate a source adapter might
// need is decided here, once, so a source file never has to guess an
// ecosystem name or a status-page host on the fly.
//
// Every entry carries all four coordinate keys even when a technology has no
// feed for one of them - `null`, never an omitted key, because
// lib/techwatch/collect.js branches on `entry.eol === null` (etc.) to report
// "no lifecycle feed" *by name* rather than lumping it in with a fetch
// failure.
//
// `osv`/`eol`/`statuspage.host` values below were checked live against the
// real endpoints on 2026-08-17 (see AC §0). Where a plausible vendor host
// turned out NOT to be genuinely Atlassian-Statuspage-hosted (Redis Labs'
// status.redis.io serves an HTML app, not the v2 JSON API; GitLab's and
// Docker's obvious guesses 404), the coordinate is left `null` rather than
// shipping a host that will 404 forever and read on screen as "that vendor
// is having a bad day."

export const MAX_WATCHLIST = 12;

export const CATALOG = [
  {
    id: "react",
    label: "React",
    aliases: ["react", "reactjs", "react.js"],
    osv: { name: "react", ecosystem: "npm" },
    eol: "react",
    statuspage: null,
    // CISA never names a JS framework by vendor/product; reached via the CVE
    // cross-mark in collect.js instead (AC §7).
    kev: null,
  },
  {
    id: "nextjs",
    label: "Next.js",
    aliases: ["nextjs", "next.js", "next"],
    osv: { name: "next", ecosystem: "npm" },
    eol: "nextjs",
    statuspage: { host: "www.vercel-status.com", vendor: "Vercel" },
    kev: null,
  },
  {
    id: "typescript",
    label: "TypeScript",
    // The only two-character alias besides "go" - watchlist.test.js and
    // catalog.test.js both pin this specific pairing.
    aliases: ["typescript", "ts"],
    osv: { name: "typescript", ecosystem: "npm" },
    // endoflife.date does not carry TypeScript at all (confirmed absent from
    // api/all.json). This is the user's own headline example of a gap that
    // must be stated on screen, not quietly filled with a guessed slug that
    // would 404 on every request.
    eol: null,
    statuspage: null,
    kev: null,
  },
  {
    id: "nodejs",
    label: "Node.js",
    aliases: ["nodejs", "node.js", "node"],
    // Node.js core CVEs are not published against an npm package name, so
    // there is no OSV coordinate that means "the runtime itself."
    osv: null,
    eol: "nodejs",
    statuspage: null,
    kev: null,
  },
  {
    id: "github",
    label: "GitHub",
    aliases: ["github", "github.com"],
    osv: null,
    eol: null,
    statuspage: { host: "www.githubstatus.com", vendor: "GitHub" },
    kev: null,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    aliases: ["cloudflare"],
    osv: null,
    eol: null,
    statuspage: { host: "www.cloudflarestatus.com", vendor: "Cloudflare" },
    kev: null,
  },
  {
    id: "npm",
    label: "npm",
    aliases: ["npm", "npmjs"],
    osv: null,
    eol: null,
    statuspage: { host: "status.npmjs.org", vendor: "npm" },
    kev: null,
  },
  {
    id: "supabase",
    label: "Supabase",
    aliases: ["supabase"],
    osv: null,
    eol: null,
    statuspage: { host: "status.supabase.com", vendor: "Supabase" },
    kev: null,
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    aliases: ["postgresql", "postgres"],
    osv: null,
    eol: "postgresql",
    statuspage: null,
    kev: ["postgresql", "postgres"],
  },
  {
    id: "python",
    label: "Python",
    aliases: ["python", "python3", "cpython"],
    // The language runtime, not a PyPI package - no OSV coordinate.
    osv: null,
    eol: "python",
    statuspage: null,
    kev: ["python"],
  },
  {
    id: "docker",
    label: "Docker",
    aliases: ["docker", "docker-engine", "dockerd"],
    osv: null,
    eol: "docker-engine",
    statuspage: null,
    kev: ["docker"],
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    aliases: ["kubernetes", "k8s"],
    osv: null,
    eol: "kubernetes",
    statuspage: null,
    kev: ["kubernetes"],
  },
  {
    id: "vue",
    label: "Vue",
    aliases: ["vue", "vuejs", "vue.js"],
    osv: { name: "vue", ecosystem: "npm" },
    eol: "vue",
    statuspage: null,
    kev: null,
  },
  {
    id: "angular",
    label: "Angular",
    // Deliberately NOT an alias of legacy AngularJS (1.x) - endoflife.date
    // tracks "angular" and "angularjs" as separate products with separate
    // lifecycles, and conflating them would misreport one as the other.
    aliases: ["angular", "angular2"],
    osv: { name: "@angular/core", ecosystem: "npm" },
    eol: "angular",
    statuspage: null,
    kev: null,
  },
  {
    id: "django",
    label: "Django",
    aliases: ["django"],
    osv: { name: "django", ecosystem: "PyPI" },
    eol: "django",
    statuspage: null,
    kev: null,
  },
  {
    id: "go",
    label: "Go",
    // The only other two-character alias, tied to "go" itself.
    aliases: ["go", "golang"],
    // The Go vulnerability database (mirrored into OSV) publishes standard
    // library advisories under the pseudo-module name "stdlib".
    osv: { name: "stdlib", ecosystem: "Go" },
    eol: "go",
    statuspage: null,
    kev: null,
  },
  {
    id: "rust",
    label: "Rust",
    aliases: ["rust", "rustlang"],
    // RustSec advisories cover individual crates, not "the compiler" as a
    // single package - no single OSV coordinate represents the language.
    osv: null,
    eol: "rust",
    statuspage: null,
    kev: null,
  },
  {
    id: "redis",
    label: "Redis",
    aliases: ["redis"],
    osv: null,
    eol: "redis",
    // status.redis.io exists but serves an HTML app, not the Atlassian v2
    // JSON API - not a coordinate this collector can read.
    statuspage: null,
    kev: ["redis"],
  },
  {
    id: "mongodb",
    label: "MongoDB",
    aliases: ["mongodb", "mongo"],
    osv: null,
    eol: "mongodb",
    statuspage: { host: "status.mongodb.com", vendor: "MongoDB" },
    kev: ["mongodb", "mongo"],
  },
  {
    id: "mysql",
    label: "MySQL",
    aliases: ["mysql"],
    osv: null,
    eol: "mysql",
    statuspage: null,
    kev: ["mysql"],
  },
  {
    id: "terraform",
    label: "Terraform",
    aliases: ["terraform"],
    osv: null,
    eol: "terraform",
    statuspage: { host: "status.hashicorp.com", vendor: "HashiCorp" },
    kev: null,
  },
  {
    id: "electron",
    label: "Electron",
    aliases: ["electron", "electronjs"],
    osv: { name: "electron", ecosystem: "npm" },
    eol: "electron",
    statuspage: null,
    kev: ["electron"],
  },
  {
    id: "tomcat",
    label: "Apache Tomcat",
    aliases: ["tomcat", "apache-tomcat"],
    osv: null,
    eol: "tomcat",
    statuspage: null,
    kev: ["tomcat"],
  },
  {
    id: "jenkins",
    label: "Jenkins",
    aliases: ["jenkins"],
    osv: null,
    eol: "jenkins",
    statuspage: null,
    kev: ["jenkins"],
  },
  {
    id: "gitlab",
    label: "GitLab",
    aliases: ["gitlab"],
    osv: null,
    eol: "gitlab",
    // The obvious host guesses (status.gitlab.com, gitlab.statuspage.io)
    // don't serve the v2 API live - not a coordinate this collector can read.
    statuspage: null,
    kev: ["gitlab"],
  },
  {
    id: "elasticsearch",
    label: "Elasticsearch",
    aliases: ["elasticsearch", "elastic"],
    osv: null,
    eol: "elasticsearch",
    statuspage: { host: "status.elastic.co", vendor: "Elastic" },
    kev: ["elasticsearch", "elastic"],
  },
];

// Used when a user's pages name nothing the catalog recognizes - a common
// early-stack-building state, not an error. Order matters: watchlist.js
// falls back to this list verbatim when detection finds nothing.
export const DEFAULT_WATCHLIST_IDS = [
  "react",
  "nextjs",
  "typescript",
  "nodejs",
  "github",
  "npm",
  "postgresql",
  "docker",
];

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id) {
  if (typeof id !== "string" || !id) return null;
  return BY_ID.get(id) || null;
}
