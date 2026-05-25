This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Gemini API Architecture

The app is wired to call Gemini from the server:

- UI form in `app/page.js`
- API route in `app/api/tailor/route.js`
- Gemini service in `lib/llm/tailorResume.js`
- Gemini client in `lib/llm/geminiClient.js`
- Server env helper in `lib/config/env.js`

### Environment Variables

All variables must be set in Vercel → **Settings → Environment Variables** (Production, Preview, Development).

For local development, create a `.env.local` file in the project root or run `npx vercel env pull hello-world/.env.local` to pull them from Vercel.

| Variable | Required | Where to get it |
|---|---|---|
| `Gemini_LLM_API_Key` | Yes | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` |
| `RAPID_API_KEY` | Yes | [RapidAPI → JSearch by letscrape](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) — subscribe to the Basic (free) plan |
| `KV_REST_API_URL` | Yes | Vercel Dashboard → Storage → your Redis database |
| `KV_REST_API_TOKEN` | Yes | Vercel Dashboard → Storage → your Redis database |

The `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables are injected automatically when you create a Redis database via **Vercel Storage** and connect it to this project.

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
