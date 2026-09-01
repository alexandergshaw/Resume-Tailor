# Resume Tailor

AI-powered job application assistant. Upload your resume, search remote jobs from 500+ companies via the Greenhouse API, and let Gemini tailor your resume to each posting. Track your applications, log interview stages, and surface job-related emails directly from your Gmail inbox.

**Live app:** [resume-tailor-tan-psi.vercel.app](https://resume-tailor-tan-psi.vercel.app)

---

## Features

- **Job search** — Search 500+ companies across tech, higher ed, healthcare, finance, and more via the Greenhouse jobs API. Results are cached in Redis (3-hour TTL) so repeat searches are instant.
- **Resume tailoring** — Paste a job description or URL, or pick a job from search results. Gemini rewrites your resume bullet-by-bullet to match the posting.
- **Cover letter generation** — Automatically generated alongside the tailored resume.
- **DOCX export** — Downloads maintain your original Word template formatting.
- **Auto-tailor (cron)** — Saved searches with "Auto-tailor daily" enabled are processed on a schedule. Each run picks the next matching role and saves a ready-to-download resume.
- **Application tracking** — Log every application, add interview stages (phone screen, technical, offer, etc.), and record communications per application.
- **Saved searches** — Save and replay job search configurations. Changes auto-save after 600 ms.
- **Hide applied jobs** — Filter out roles you've already applied to from search results. Preference is persisted to Redis.
- **Gmail integration** — Connect your Gmail inbox via OAuth2. The envelope icon fetches and matches job-related emails to your tracked applications by company name and job title.
- **In-app notifications** — Bell icon surfaces auto-tailor completions and other events.
- **AI chat** — Draggable chat panel powered by Gemini. Pin job/application context and ask anything about your search.

---

## Architecture

```
app/
  page.js                        Main React page (applying + tracking tabs)
  layout.js                      Root layout — header with AuthButton + GmailButton
  components/
    AuthButton.js                Sign in / sign out (Supabase Google OAuth)
    GmailButton.js               Connect / disconnect Gmail OAuth2
    JobSearchTab.js              Job search UI, filters, results
    TrackingTab.js               Application tracking table
    AutoTailorTab.js             Auto-tailor queue viewer
    ChatPanel.js                 AI chat drawer
    StatusBar.js                 Tracked-job chips toolbar
    ... (other dialogs)
  api/
    tailor/                      POST — Gemini resume tailoring
    greenhouse/                  GET — Greenhouse jobs API proxy + Redis cache
    applied/                     GET / POST / DELETE — applied job IDs
    jobs/                        Job search orchestration
    saved-searches/              CRUD for saved search configurations
    user-prefs/                  Redis-backed UI preferences (hideAppliedJobs, etc.)
    user-context/                Additional context / references / education
    gmail/
      connect/                   GET — redirect to Google OAuth2 consent screen
      oauth2callback/            GET — exchange code for tokens, store in Redis
      status/                    GET — { connected: boolean }
      disconnect/                DELETE — remove stored tokens
      messages/                  POST — fetch + match job-related Gmail messages
    notifications/               GET / PATCH — in-app notifications
    cron/tailor/                 POST — scheduled auto-tailor pipeline
    fetch-posting/               GET — scrape job description from a URL
    health/                      GET — liveness check

lib/
  llm/
    geminiClient.js              Gemini API client
    tailorResume.js              Resume tailoring prompt + response parsing
  greenhouse/
    companies.js                 Master company list (500+ companies, 10+ categories)
    highered_colleges.js         100+ higher education institutions
  gmail/
    gmailClient.js               Google OAuth2 client, token storage, Gmail API fetch
    emailUtils.js                Pure matching — score/rank Gmail messages against applications
  chat/
    chatbot.js                   Chat handler factory (extracted from page.js)
  document/
    docx.js                      DOCX template parsing + download helpers
  cache/
    jobCache.js                  getCached / setCached helpers
    redisClient.js               Upstash Redis singleton
  supabase/
    client.js                    Browser Supabase client
    server.js                    Server Supabase client (Next.js cookies)
    upsertApplication.js         Upsert application rows
    upsertPosition.js            Upsert position rows
    upsertInterviewStage.js      Upsert interview stage rows
    recruiterCommunications.js   Communications log helpers
    logChatMessage.js            Chat message persistence
    saveGeneratedResume.js       Save tailored resume to Supabase Storage
  config/
    env.js                       getServerEnv() — validated server-side env vars
```

---

## Environment Variables

All variables must be set in Vercel → **Settings → Environment Variables** (Production, Preview, Development).

For local development, create a `.env.local` file in `hello-world/` or run `npx vercel env pull hello-world/.env.local` to pull them from Vercel.

| Variable | Required | Where to get it |
|---|---|---|
| `Gemini_LLM_API_Key` | Yes | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` |
| `KV_REST_API_URL` | Yes | Vercel Dashboard → Storage → your Redis database |
| `KV_REST_API_TOKEN` | Yes | Vercel Dashboard → Storage → your Redis database |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase → Project Settings → API → Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase → Project Settings → API → Secret key |
| `CRON_SECRET` | Yes (for cron) | Any long random string — sent as `Authorization: Bearer <secret>` by Vercel's scheduler |
| `GOOGLE_CLIENT_ID` | Yes (for Gmail) | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs |
| `GOOGLE_CLIENT_SECRET` | Yes (for Gmail) | Same OAuth client as above |
| `BRAVE_SEARCH_API_KEY` | No | [Brave Search API](https://brave.com/search/api/) — sturdier offline screenshot search (Embedded engine). Falls back to DuckDuckGo if unset |
| `GOOGLE_SEARCH_API_KEY` | No | [Google Programmable Search](https://developers.google.com/custom-search/v1/overview) — alternate offline search provider (used if Brave isn't set) |
| `GOOGLE_SEARCH_ENGINE_ID` | No | The `cx` id of your [Programmable Search Engine](https://programmablesearchengine.google.com/); required alongside `GOOGLE_SEARCH_API_KEY` |
| `STT_PROVIDER` | No | Selects the interview copilot's speech-to-text provider: `deepgram` or `elevenlabs`. Defaults to `deepgram` when unset, and also falls back to `deepgram` for any unrecognized value. |
| `ELEVENLABS_API_KEY` | Only if `STT_PROVIDER=elevenlabs` | [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) — used to mint short-lived realtime transcription tokens for the interview copilot. Each token is single-use (consumed on first use) and expires after 15 minutes, so it's minted fresh per session rather than cached. Not read at all when `STT_PROVIDER` is unset or `deepgram`. |

The `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables are injected automatically when you create a Redis database via **Vercel Storage** and connect it to this project.

---

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the following SQL in **SQL Editor** to create the applied jobs table:

```sql
create table applied_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  job_id text not null,
  job_title text,
  company text,
  job_url text,
  job_description text,
  applied_at timestamptz default now(),
  unique (user_id, job_id)
);
alter table applied_jobs enable row level security;
create policy "Users manage own rows" on applied_jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grant table-level access to signed-in users (required in addition to RLS)
grant select, insert, update, delete on public.applied_jobs to authenticated;
```

Then run this to set up the Storage bucket for resumes:

```sql
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict do nothing;

create policy "Users manage own files" on storage.objects
  for all using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

grant select, insert, update, delete on storage.objects to authenticated;
```

3. Enable **Google OAuth** in Supabase → Authentication → Providers → Google.
   - Create a **separate** OAuth client in [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth client → Web application. This client is for Supabase sign-in only — **not** the same client used for Gmail.
   - Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an Authorized redirect URI.
   - Paste the Client ID and Secret into Supabase → Authentication → Providers → Google.
4. Set redirect URLs in Supabase → Authentication → **URL Configuration**:
   - **Site URL**: your environment's base URL (e.g. `https://your-preview.vercel.app`)
   - **Redirect URLs**: add `<site-url>/auth/callback` for each environment
5. Copy the **Project URL**, **Publishable key**, and **Secret key** from Supabase → Project Settings → API into your Vercel environment variables.

> **Note on environments:** Supabase doesn't have built-in env tiers. For production, create a separate Supabase project and scope each set of env vars to the appropriate Vercel environment (Preview vs Production).

---

## Gmail Integration Setup

Gmail uses a **separate** Google OAuth2 client from the Supabase sign-in client.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → **Library** → enable the **Gmail API**.
2. Go to APIs & Services → **OAuth consent screen**:
   - User Type: External
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add your Google account as a **Test user** (required while the app is unverified)
3. Go to APIs & Services → **Credentials** → Create OAuth client → Web application:
   - Authorized redirect URIs:
     - `https://resume-tailor-tan-psi.vercel.app/api/gmail/oauth2callback`
     - `http://localhost:3000/api/gmail/oauth2callback` (for local dev)
4. Copy the **Client ID** and **Client Secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your Vercel environment variables (and `.env.local` locally).
5. In the app, click **Connect Gmail** in the header to authorize access.

Token flow: `/api/gmail/connect` → Google consent → `/api/gmail/oauth2callback` (stores tokens in Redis) → back to app. The envelope icon in the header then fetches job-related emails and matches them to your tracked applications by company name and job title.

---

## Google Drive Integration Setup

Drive authenticates with whatever client `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` point at —
`lib/drive/driveOAuth.js` reads that one pair straight from `process.env`, and the Gmail
integration reads the same pair. There is no separate "Drive client" env var. But the consent flow
**is** separate: its own callback URI, its own scopes. Registering Gmail's callback does not
register Drive's, and an unregistered one gets you `Error 400: redirect_uri_mismatch`.

**Which client is it?** Not necessarily one you created for Gmail. If Drive reaches Google's
consent page at all, then `GOOGLE_CLIENT_ID` is set and valid (a wrong one fails as
`invalid_client`, not `redirect_uri_mismatch`) — it may be the client you made for Supabase Google
sign-in. To identify it, read `client_id=` out of the address bar on the Google error page, or
check the value in Vercel → Settings → Environment Variables, and match it against
APIs & Services → **Credentials**. If no such client exists, create one (Create credentials →
OAuth client ID → **Web application**) and put its ID and secret into `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` in Vercel and in `.env.local`.

1. Google Cloud Console → APIs & Services → **Library** → enable the **Google Drive API**.
2. APIs & Services → **OAuth consent screen** → add both Drive scopes:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/userinfo.email`

   Add your own Google account as a **Test user** while the app is unverified.
3. APIs & Services → **Credentials** → open that client → add to
   **Authorized redirect URIs**:
   - `https://resume-tailor-tan-psi.vercel.app/api/drive/oauth2callback`
   - `http://localhost:3000/api/drive/oauth2callback` (for local dev)

   Add one entry per deployment origin you actually sign in from — the routes build the redirect
   from the *incoming request's* origin (`` `${origin}/api/drive/oauth2callback` ``), so a Vercel
   preview URL needs its own entry.
4. Changes to redirect URIs can take a few minutes to propagate; re-try **Connect Drive** after.

Token flow: `/api/drive/connect` → Google consent → `/api/drive/oauth2callback` (stores tokens in
the `drive_connections` table) → back to app.

---

## Auto-tailor Cron

The daily auto-tailor pipeline lives at `app/api/cron/tailor/route.js` and is scheduled in `vercel.json`. Each run tailors at most one new resume per user per saved search. Results are saved to `generated_resumes`, the application is marked `tailored`, and a notification row is written.

To enable:

1. Apply the migration in `db/migrations/001_saved_searches_and_notifications.sql` via Supabase SQL Editor.
2. Set `CRON_SECRET` in your environment.
3. Deploy to Vercel — `vercel.json` registers the cron job automatically.
4. To trigger manually: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/tailor`

---

## Development

```bash
cd hello-world
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
