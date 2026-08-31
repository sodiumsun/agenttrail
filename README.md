<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/agenttrail-mark-dark.svg">
  <img src="assets/brand/agenttrail-mark-black.svg" alt="agenttrail" width="96">
</picture>

# agenttrail

**Know what your coding agents are doing, while they are doing it.**

[![npm](https://img.shields.io/npm/v/agenttrail?color=e9a23b&label=npm)](https://www.npmjs.com/package/agenttrail)
[![downloads](https://img.shields.io/npm/dm/agenttrail?color=e9a23b&label=downloads)](https://www.npmjs.com/package/agenttrail)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![stars](https://img.shields.io/github/stars/sodiumsun/agenttrail?style=social)](https://github.com/sodiumsun/agenttrail)

</div>

Your coding agent has been working for half an hour. Is it making progress? Is it stuck? Did it quietly reopen the part it already called done?

agenttrail is a local, open-source observability layer for AI coding agents. It turns plans, tool calls, file changes, and progress from Claude Code, OpenAI Codex, Cursor, or any agent that edits files into a live project map.

Start an agent, walk away, and come back to this:

![agenttrail watching itself being built: a Claude session appears with its plan, edits stream live, and the demo task ticks green on camera](docs/demo.gif)

```bash
cd your-repo
npx agenttrail
```

The browser opens on the live board. On a repo with no plan it offers the full setup inline — one y/n, and the backfill prompt lands on your clipboard. Hooks are only wired with your consent. After a reboot, `npx agenttrail up` relaunches every board you've ever run; `npx agenttrail autostart` makes a repo's board start at login and self-heal.

That's it. No account, no global install, no telemetry. agenttrail opens on localhost and starts watching the repo.

## How the live agent map works

A plan says what the agent intends to do. The filesystem says what it actually touched. agenttrail shows both.

| Signal | What it tells you |
|---|---|
| **Declared** | The component and task the agent says it is working on |
| **Observed** | The files it is changing right now, including revisions to finished work |

When those signals disagree, you know where to look. A completed card lights up when its files change again. A live run sits on the component it is touching. The map moves as the work moves.

## What you see

- A map of 5–9 real components, with dependency arrows, dashed links, progress, and honest done, working, or blocked states
- The current Claude Code run, including its task list, streaming tool line, elapsed time, and recent calls
- The agent's own session plan inside the component it is working on, fading out a couple of hours after the run ends
- A VS Code style repo tree with live "just touched" accents and a **Working** signal
- Provenance pills that keep imminent agent intent separate from roadmap backlog
- The Claude spark, OpenAI blossom, or contributor initials on completed tasks
- One daemon per repo, with every live board in one tab switcher. Adding a repo is a sentence to your agent — *"run npx agenttrail in this repo"* — and the tab appears on every board within seconds; kill that daemon and it disappears everywhere

Instead of replaying a transcript, agenttrail shows the shape of the work, updated live.

## Give it the real map

The first command works with any repo. You immediately get the live file tree, activity state, and Claude Code run cards when local hooks are present.

For the full component map, run this once:

```bash
npx agenttrail init
```

`init` adds the agenttrail convention to `CLAUDE.md` and `AGENTS.md`, creates a starter `PLAN.md`, and installs additive local Claude Code hooks. Then click **Copy backfill prompt** on the board and paste it to your agent.

The agent studies the code first, git history next, and planning prose last. It draws the repo as 5–9 components with real dependencies and verifiable statuses. You do not maintain a project-management board. Your agents maintain one small Markdown file as they work.

## Supported coding agents

| Agent | Live activity | Run cards and todos | Maintains the map |
|---|---|---|---|
| Claude Code | ✅ file watcher | ✅ local hooks | ✅ `CLAUDE.md` |
| OpenAI Codex | ✅ file watcher | — | ✅ `AGENTS.md` |
| Cursor or anything else | ✅ file watcher | — | ✅ `AGENTS.md` |

## Local by construction

The daemon is one dependency-free Node file, about 470 lines. The interface is one static HTML file. There is no database, build step, cloud service, account, or telemetry.

It binds to **127.0.0.1 only**. Claude Code hooks live in the repo-local `.claude/settings.local.json` and relay events to the local daemon. While it runs, agenttrail only observes. It never sends a prompt or edits your code.

The entire model comes from two sources:

1. `PLAN.md`, the durable map curated by your agents
2. Local events, the live trail that fades as activity gets old

Read the core: [`bin/agenttrail.mjs`](bin/agenttrail.mjs).

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

## Decide what matters {#classify}
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

## FAQ

**Does it work without `PLAN.md`?** Yes. The live tree, activity feed, and run cards need no plan. The map appears when your agent writes one.

**What does coding agent observability mean here?** LLM observability usually focuses on traces, latency, tokens, and cost. agenttrail focuses on the work happening in a repo: which component an agent is in, what tool it is running, what files it is changing, and whether its plan is moving.

**Which AI coding agents does agenttrail support?** Claude Code has the richest live view through local hooks. OpenAI Codex, Cursor, and any agent that edits files work through the repo watcher and can maintain the map through `AGENTS.md`.

**Does agenttrail control my agent?** No. It observes and draws. It never sends a prompt. `init` prints the optional backfill prompt, and the board can copy it to your clipboard.

**What does `init` change?** It creates the starter plan, appends the convention to the repo's agent instruction files, adds `.agenttrail/` to `.gitignore`, and installs local Claude Code hooks. The running dashboard itself is read only.

**What about a huge repo?** agenttrail has been tested on a 78k-file repo. It reads the tree breadth first with per-directory caps, sends tiny SSE activity ticks, and tells you when the tree is abridged.

**What if the plan goes stale?** Tell any agent: `re-verify PLAN.md against the code.` The board updates as the file does.

## License

MIT
