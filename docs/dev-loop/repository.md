# Resume-Tailor loop adaptation

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

Implementation policy: local reads, scoped writes, offline tests and fixture
processes are authorized. No installation, login, paid dispatch, deployment or
external messaging. Provider templates remain disabled and unqualified. Existing
product backlog work is outside this request. Host coordination records in this
directory are manual; they are not engine-generated acceptance records.
