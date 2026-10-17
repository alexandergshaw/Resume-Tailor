# Resume-Tailor loop adaptation

Standing live-app instrument: use authorized browser control at
`https://resume-tailor-tan-psi.vercel.app/` for every delivery, following the
[owner live verification policy](../../AGENTS.md#owner-verification-policy--always-verify-in-the-live-app).
Record candidate/deployment identity, time, user-flow steps, expected/observed
results and sanitized evidence; independently review it. Include relevant error,
recovery and persistence paths. Documentation/engine-only work requires a live
smoke check as separate regression evidence. Missing deployment/access/authority
is pending verification, never a pass. The engine completion guard enforces a
current independently accepted live-verification report; the Git-only delivery
command checks publication separately. Browser truth still requires actual host
observations and independent review of the evidence.

The product application is in `hello-world/`. The authoritative product backlog is
`docs/backlog.yml`; `docs/BACKLOG.md` is generated. Existing `.claude/` workflows
and historical `docs/loop/` evidence are preserved. The new engine lives outside
the application under `tools/` and has its own test configuration.

Discovered instruments (not claims that they passed):

| Working directory | Command | Purpose |
| --- | --- | --- |
| repository | `npm.cmd run loop:test` | Durable engine and transport tests |
| repository | `npm.cmd run loop:demo -- .agnostic-loop/demo` | Offline public CLI lifecycle |
| hello-world | `npm.cmd test` | Application unit/regression suite |
| hello-world | `npm.cmd run lint` | ESLint including no-undef |
| hello-world | `npm.cmd run build` | Next production build; prebuild stages MediaPipe |
| hello-world | `npm.cmd run backlog:check` | Generated backlog and contract checks |

There is no application TypeScript configuration; do not register another
repository's `tsc` command as an application verification gate. Browser geometry,
accessibility, authenticated providers, live Supabase/Gmail and model output
quality need their own instruments and authorization. Fixture workers establish
protocol behavior only. Build and test processes share workspace resources and
must be serialized. Mutation harnesses use isolated temporary copies.

Initial working tree: only `.claude/settings.local.json` was untracked. Preserve
it. Base revision: `6c4befea900a4ac239eb95f258c6a708a3708e8c`.

Historical initial-port policy: local reads, scoped writes, offline tests and fixture
processes are authorized. No installation, login, paid dispatch, deployment or
external messaging. Provider templates remain disabled and unqualified. Existing
product backlog work is outside this request. Host coordination records in this
directory are manual; they are not engine-generated acceptance records.

Later owner authorization (2026-10-16) requests bounded live-provider qualification
and work through the product backlog. Current accepted contracts and limits are in
`items/live-provider/` and `items/N97/`, with coordinator intake in `state.json`.
This extends the historical port scope; it does not authorize deployment or an
unbounded production provider grant. The standing normal-push/main delivery guard
continues to apply to every authorized chunk.
