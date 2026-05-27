This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Architecture

The app is wired to call Gemini from the server:

- UI form in `app/page.js`
- API route in `app/api/tailor/route.js`
- Gemini service in `lib/llm/tailorResume.js`
- Gemini client in `lib/llm/geminiClient.js`
- Server env helper in `lib/config/env.js`

Job data flows through:

- `app/api/greenhouse/route.js` — fetches jobs from the [Greenhouse API](https://boards-api.greenhouse.io) for tracked companies
- `lib/greenhouse/companies.js` — master list of companies and categories
- `lib/cache/jobCache.js` + `lib/cache/redisClient.js` — Redis caching (4-hour TTL per company)

Auth and persistence:

- `lib/supabase/client.js` — browser Supabase client
- `lib/supabase/server.js` — server Supabase client (Next.js cookies)
- `middleware.js` — refreshes Supabase auth sessions on every request
- `app/api/applied/route.js` — GET / POST / DELETE for a user's applied jobs
- `app/auth/callback/route.js` — OAuth code-exchange handler after Google sign-in
- `app/components/AuthButton.js` — "Sign in with Google" / "Sign out" button in the header

### Environment Variables

All variables must be set in Vercel → **Settings → Environment Variables** (Production, Preview, Development).

For local development, create a `.env.local` file in the project root or run `npx vercel env pull hello-world/.env.local` to pull them from Vercel.

| Variable | Required | Where to get it |
|---|---|---|
| `Gemini_LLM_API_Key` | Yes | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` |
| `KV_REST_API_URL` | Yes | Vercel Dashboard → Storage → your Redis database |
| `KV_REST_API_TOKEN` | Yes | Vercel Dashboard → Storage → your Redis database |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Project Settings → API → **Project URL** (e.g. `https://xxxx.supabase.co` — no trailing path) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase → Project Settings → API → **Publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase → Project Settings → API → **Secret** key (never expose client-side) |
| `CRON_SECRET` | Yes (for cron) | Any long random string; sent as `Authorization: Bearer <secret>` to `/api/cron/tailor`. Set the same value in Vercel → Project → Settings → Cron Jobs so Vercel's daily invocation can authenticate. |
| `RESEND_API_KEY` | Yes (for email) | [Resend Dashboard](https://resend.com/api-keys) |
| `RESEND_FROM` | Yes (for email) | A verified sender, e.g. `Resume Tailor <noreply@yourdomain.com>` |
| `APP_BASE_URL` | No | Used in digest emails for a "Open Resume Tailor" CTA, e.g. `https://your-app.vercel.app` |

The `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables are injected automatically when you create a Redis database via **Vercel Storage** and connect it to this project.

### Supabase Setup

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
   - You'll need a Google OAuth **Client ID** and **Client Secret** from [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth client → Web application.
   - Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an **Authorized redirect URI** in Google Cloud Console.
   - Paste the Client ID and Secret into Supabase → Authentication → Providers → Google.
4. Set redirect URLs in Supabase → Authentication → **URL Configuration**:
   - **Site URL**: your current environment's base URL (e.g. `https://your-preview.vercel.app`)
   - **Redirect URLs**: add `<site-url>/auth/callback` for each environment
   - ⚠️ If the redirect URL isn't in the allowlist, Supabase falls back to the Site URL — update both when switching environments.
5. Copy the **Project URL**, **Publishable key**, and **Secret key** from Supabase → Project Settings → API into your Vercel environment variables.

> **Note on environments:** Supabase doesn't have built-in env tiers. For production, create a separate Supabase project and scope each set of env vars to the appropriate Vercel environment (Preview vs Production).

### Auto-tailor cron + notifications

The daily auto-tailor pipeline lives at `app/api/cron/tailor/route.js` and is scheduled in `vercel.json` (default: 13:00 UTC). It scans every saved search where the user has flipped **Auto-tailor daily** ON, tailors a resume for each new matching role (up to the per-search **Daily cap**), saves results to `generated_resumes`, marks applications as `tailored`, and writes a row to the new `notifications` table. If `RESEND_API_KEY` + `RESEND_FROM` are configured and the user hasn't disabled it, a digest email is also sent via Resend.

To enable:

1. Apply the migration in `db/migrations/001_saved_searches_and_notifications.sql` via Supabase SQL Editor.
2. Set `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, and (optionally) `APP_BASE_URL` in your environment.
3. Deploy to Vercel — `vercel.json` registers the cron job automatically. Vercel will call `/api/cron/tailor` once per day with the `Authorization: Bearer ${CRON_SECRET}` header.
4. (Optional) To trigger a run manually: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/tailor`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
