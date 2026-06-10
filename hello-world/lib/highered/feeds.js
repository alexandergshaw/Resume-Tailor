// VERIFIED live higher-education job RSS feeds.
//
// Inside Higher Ed's careers RSS supports a `Keywords` query param and returns
// real postings (confirmed live). We target the contingent/adjunct faculty
// market with a few keyword feeds rather than one firehose. These are the
// primary source of genuine university adjunct/faculty postings, since most
// schools post via Interfolio/PageUp/Workday rather than a public JSON board.
//
// Each entry: { url, label }
export const HIGHERED_RSS_FEEDS = [
  {
    url: "https://careers.insidehighered.com/jobsrss/?Keywords=adjunct",
    label: "Inside Higher Ed — Adjunct",
  },
  {
    url: "https://careers.insidehighered.com/jobsrss/?Keywords=lecturer",
    label: "Inside Higher Ed — Lecturer",
  },
  {
    url: "https://careers.insidehighered.com/jobsrss/?Keywords=instructor",
    label: "Inside Higher Ed — Instructor",
  },
  {
    url: "https://careers.insidehighered.com/jobsrss/?Keywords=visiting+assistant+professor",
    label: "Inside Higher Ed — Visiting Faculty",
  },
];
