# Contributing to Agenttrail

Agenttrail is a local observability tool for AI coding agents: a live project map fed by `PLAN.md`, file changes, and local agent logs and hooks. It observes agents running in their existing tools; it does not orchestrate them. [Product and data model](docs/OBSERVABILITY.md)

## Find the relevant code

| Area | Location |
| --- | --- |
| Daemon, plans, hooks and fleet | `bin/agenttrail.mjs` |
| Bounded log reading shared by the adapters | `bin/lib/logtail.mjs` |
| Claude Code and Codex log adapters | `bin/lib/claude.mjs`, `bin/lib/codex.mjs` |
| Native task lists | `bin/lib/tasks.mjs` |
| Superpowers specs, plans and ledgers | `bin/lib/superpowers.mjs` |
| Interface | `public/index.html` |
| Automated checks | `test/` |

Keep provider interpretation in the adapters, as effects the daemon applies to a run, and out of the page.

## Run and check it

```sh
node bin/agenttrail.mjs /path/to/a/disposable/repo
npm test
node --check bin/agenttrail.mjs
npm pack --dry-run
```

There are no dependencies to install. Tests run every daemon from a temporary HOME and repo on a private port range. To do the same by hand, set `HOME`, `AGENTTRAIL_PORT_BASE` and `AGENTTRAIL_PORT`.

Live provider validation should use your own disposable project. Do not install hooks into unrelated repos or submit real transcripts as test fixtures. Keep fixtures synthetic, small and focused on a real failure mode.

## Preserve the meaning of activity

- Never replace missing task progress with an invented checklist. Unknown stays unknown.
- A native task commits only on a recognised success. A proposal is not a result.
- A turn ending, tool finishing or file changing does not prove an outcome shipped.
- Label inferred associations as inferred.
- Provider logs are read-only, and reads stay bounded: real logs reach a gigabyte.
- Keep pending human actions in the provider's own tool. This project observes; it does not approve or run those actions.

## Report a problem

Use the [issue tracker](https://github.com/sodiumsun/agenttrail/issues). Include the package version, OS, Node version, provider and a short reproduction. Redact project paths, task titles and private data from screenshots.

In a pull request, explain the trigger, resulting behavior and relevant checks. Include a screenshot or short silent clip for visible changes.

## License

Project code and original assets are MIT. Preserve the root license. Do not add personal logs, secrets or local connection state. Contributions must be yours to contribute under the relevant license.
