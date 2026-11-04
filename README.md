<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/agenttrail-mark-dark.svg">
  <img src="assets/brand/agenttrail-mark-black.svg" alt="agenttrail" width="96">
</picture>

# agenttrail

**Local observability for AI coding agents.**

[![Map on npm](https://img.shields.io/npm/v/agenttrail?color=e9a23b&label=npm)](https://www.npmjs.com/package/agenttrail)
[![Map checks](https://github.com/sodiumsun/agenttrail/actions/workflows/map.yml/badge.svg)](https://github.com/sodiumsun/agenttrail/actions/workflows/map.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Agenttrail draws a live map of your project and shows where your coding agents are working on it: which part is changing, which tasks each session has reported, and what it is doing now. You see that in one browser tab instead of piecing it together from several terminal windows.

Your agents keep running in tools such as Claude Code and Codex. Agenttrail reads local files, your plan and the agents' local logs, and shows that evidence. It does not run agents, assign their work or decide that a task is finished.

![Agenttrail Map showing live sessions, component progress and file changes](docs/demo.gif)

## Run it in your repo

You need **Node.js 20+** and a local project folder.

```bash
cd your-repo
npx agenttrail
```

The map opens in your browser at **localhost:5330**, or the next free port. Keep working in your coding agent. Claude Code and Codex sessions in this repo appear as run cards from their local logs, with nothing to install. File changes appear as they happen.

Watching does not change your repo. In an interactive terminal, starting without a `PLAN.md` offers to set one up, and you can decline.

## Draw the component map

File activity and run cards work on their own. The component map needs a plan.

Run `npx agenttrail init`, review the setup, then give your agent the backfill prompt from the board. It adds the convention to `CLAUDE.md` and `AGENTS.md`, creates a starter plan, offers local Claude Code hooks, and adds `.agenttrail/` to `.gitignore`. **Setup writes these files; normal watching does not.** Noninteractive `init` assumes yes, so run it only when you intend to configure the repo.

The map combines declared intent in `PLAN.md` with observed file changes. A completed component lights up when its files change again. It also has a live file tree, dependency links, session trails and an overview of multiple repos. `npx agenttrail up` relaunches saved boards after a reboot; `npx agenttrail autostart` configures startup at login.

<details>
<summary><b>The PLAN.md convention</b></summary>

```markdown
# my project

## Capture the audio {#capture}
tech: coreaudio tap + ring buffer
files: [src/audio/**]
- [x] Grab the mic feed {#capture-mic}
  by: claude
- [~] Keep the last 30 seconds ready {#capture-ring}
  by: claude

## Classify the alerts {#classify}
needs: [capture]
links: [notify]
- [ ] Score events by urgency {#classify-score}
  from: roadmap

## decisions
- 2026-08-21: dropped redis for summaries; in-process queue instead
```

- Components use stable `{#id}` values and concrete, owner-readable names
- `files:` connects observed writes to the component they belong to
- `[~]` means working, `[x]` means done, and `[!]` means stuck
- `needs:` draws dependency arrows; `links:` draws dashed connections
- `by:` records who did the work; `from:` separates agent intent from roadmap intent
- `kind: knowledge` renders a component as a purple knowledge organ; `kind: human` renders it dashed in its own color — the step where a person enters the loop; `url:` makes the card clickable, opening the artifact it produces
- Backfilled completed tasks cite their implementing file as evidence
- Agents record plan-affecting decisions before they act on them

</details>

## What it can see

| Tool | How Map sees it | What you get |
| --- | --- | --- |
| Claude Code | Local logs in `~/.claude/projects`, automatically. Hooks are optional | Sessions, tool activity, file trails, sub-agents, and task lists from `TaskCreate`/`TaskUpdate` or `TodoWrite` |
| Codex | Local logs in `~/.codex/sessions`, automatically | Sessions, tool activity and file trails. Plans appear only when the log contains an `update_plan` call, which recent versions rarely write, so they usually show as unknown |
| Cursor and other tools | No session adapter | File changes and whatever the agent records in `PLAN.md` |

Claude Code hooks are not needed to see a session. They add three things: events the moment they happen rather than within a few seconds, a reminder to the agent when the plan has fallen behind the code, and a terminal id in Map's data when the terminal sets `HC_TERMINAL_ID`. A session seen through both hooks and its log stays one run.

Map reads logs touched in the last two hours and at most the last 2 MiB of each. Cloud sessions with no logs on this machine are not visible. Local log formats can change between agent versions. [How observability works](docs/OBSERVABILITY.md)

## Beside your agents in Herdr

A panel for the [Herdr](https://herdr.dev) desktop app shows each agent's task, its recent path through the project and its status, and jumps to its terminal on a click. It reads Map through a small read-only feed. See [herdr/README.md](herdr/README.md).

## Local by construction

Map binds to **127.0.0.1**. It needs no account, telemetry, transcript upload, model call or cloud service, and it opens agent logs read-only. Run cards can show shortened command text, search terms and other tool details, and Map saves recent activity under `~/.agenttrail`. Review what is visible before sharing a recording. [Data sources and local storage](docs/OBSERVABILITY.md#what-stays-on-your-machine)

Map is a dependency-free Node daemon and a static page. It does not control your agents, send prompts, approve actions or mark their tasks complete.

## FAQ

**Is Agenttrail an agent framework?** No. You run agents in their existing tools, and Agenttrail shows the available evidence of what they are doing. Token billing and full model traces are not implemented.

**Will this work in an existing repo?** Yes, run it from that folder. Git and `PLAN.md` are optional.

**Why is a session missing?** A new session can take about ten seconds to appear. It must be working inside the watched repo, with its logs on this machine. A session that has been silent for two hours drops off the live view.

**Does a finished task mean the work shipped?** No. It means the agent reported the task complete. A turn ending or a file changing does not prove an outcome either.

**What changes in my repo?** Watching changes nothing. `init` creates the plan and agent instructions, offers hooks in `.claude/settings.local.json`, and adds a `.gitignore` entry.

**What is still unverified?** Windows has not been tested. Automated checks run on Linux and macOS.

**What happened to Kitchen?** The experimental 3D view has been retired so the project can focus on Map. Its last release stays on npm as `agenttrail-kitchen`, without further updates.

## Contribute and license

[Report a bug](https://github.com/sodiumsun/agenttrail/issues) · [Contributing](CONTRIBUTING.md)

MIT for the project code and original assets.
