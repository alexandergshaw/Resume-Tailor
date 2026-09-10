### R-074 | area: copilot-config | parallel-safe: yes | automatable: yes

**Summary:** The copilot can open a session on a deploy with no Gemini key. Transcription is independent of the LLM, so requiring an LLM key to mint a transcription token was a coupling bug that made the whole copilot unusable on a keyless (embedded-engine) deploy.

**Steps:**
1. Read `getDeepgramApiKey` in `hello-world/lib/config/env.js` and confirm it does not go through `REQUIRED_SERVER_KEYS`.
2. Read `app/api/copilot/token/route.js` and confirm the order of the auth check and the configuration check.
3. Run `npx vitest run --no-file-parallelism lib/config/env.test.js app/api/copilot/token/route.test.js` from `hello-world/`.

**Expected:** With `Gemini_LLM_API_Key` unset and the selected provider's key set, a signed-in POST mints a token successfully — before the fix this returned a 500 and no session could start. `getServerEnv()` itself is unchanged and still throws when the Gemini key is missing, because its other callers depend on that. An unauthenticated request returns the existing 401 EVEN when the provider is unconfigured, so an anonymous caller cannot probe the deployment's configuration; only a signed-in caller can learn that a provider key is unset.

### R-080 | area: copilot-config | parallel-safe: yes | automatable: yes

**Summary:** Provider selection is a server decision, misconfiguration names the provider actually selected, and asking which provider is live costs nothing.

**Steps:**
1. Read `getSttProvider` and `getElevenLabsApiKey` in `hello-world/lib/config/env.js`.
2. Read both the `GET` and `POST` handlers in `app/api/copilot/token/route.js`.
3. Run `npx vitest run --no-file-parallelism lib/config/env.test.js app/api/copilot/token/route.test.js` from `hello-world/`.

**Expected:** `STT_PROVIDER` selects the provider; unset, empty or unrecognized values resolve to Deepgram, so today's deploys are unaffected. `GET` returns `{ provider }` only — it mints nothing and makes no outbound provider call, which is the entire reason it exists: learning the provider name for the consent notice must not burn a single-use credential on every page view. `GET` is auth-gated exactly like `POST`, with auth ahead of configuration. `POST` mints from the selected provider, sending `xi-api-key` to the ElevenLabs single-use-token endpoint on that path. When the selected provider's key is unset the response is a 503 naming THAT provider and THAT environment variable, and it never silently falls back to the other provider.

