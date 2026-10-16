# Resume-Tailor

The Next.js application is in `hello-world/`. Its scripts and dependencies remain
in that directory. The authoritative product backlog is `docs/backlog.yml`;
`docs/BACKLOG.md` is generated.

The repository also includes a provider-agnostic durable development loop: a local
CLI, transactional state and evidence-bound handoffs. Start with
[operator usage](docs/dev-loop/USAGE.md) and the
[development workflow](docs/dev-loop/WORKFLOW.md). Repository instructions are in
[AGENTS.md](AGENTS.md).

Delivery requires committing verified changes on `main`, pushing to `origin/main`,
and passing `npm.cmd run loop:delivery`. The root handoff command rejects overall
completion for unpublished local work.

From the repository root, using Node 22.14.0 or later and the already installed
`hello-world/node_modules` dependencies:

```powershell
npm.cmd run loop -- help
npm.cmd run loop:test
npm.cmd run loop:demo -- .agnostic-loop/first-demo
```

The demo requires a new or empty directory and exercises an offline fixture; it
does not establish acceptance of this port or call a paid provider. Automatic
provider dispatch remains disabled. Application checks and supervisor diagnostics
are recorded separately from the mandatory engine/manual-port tests.
