# How Agenttrail observes your agents

Agenttrail is a local observability tool for AI coding agents. It reads available evidence of their work and presents it in two views: **Agenttrail Map** and **Agenttrail Kitchen**. You continue to prompt, run and approve your agents in their existing tools.

The project focuses on what is changing, which tasks are reported, who contributed and where attention is needed. It does not currently provide token billing, model-quality evaluations or a complete trace of every model request.

## One project, two views

| | Map | Kitchen |
| --- | --- | --- |
| Question it helps answer | Which parts of this project are changing, and how do they relate? | What work is happening now, and which responsibilities contribute? |
| Unit of structure | A durable component in `PLAN.md` | A project responsibility, shown as a chef |
| Unit of work | Plan tasks, file activity and supported run events | An available native todo, shown as a dish |
| Presentation | Components, dependencies, activity and session trails | Chefs, order tickets, cooking and deliveries |
| Command | `npx agenttrail` | `npx agenttrail-kitchen .` |
| Default local port | 5330 | 4780 |

Both are browser companions in this repository. Each has its own package, local service, adapters and history. Either can run independently. Kitchen can read context from a running Map, but there is not yet one shared event backend or a synchronized view switcher.

## Where the information comes from

```mermaid
flowchart LR
  P["PLAN.md: declared structure and progress"] --> M["Agenttrail Map"]
  F["Local file changes"] --> M
  H["Claude Code hooks"] --> M
  P --> K["Agenttrail Kitchen"]
  F --> K
  L["Local Codex and Claude logs"] --> K
  X["Local Codex logs"] --> M
  C["Optional Claude and Cursor hooks"] --> K
  M -. "Available board context" .-> K
```

`PLAN.md` describes durable project components and declared task status. File watching supplies evidence of edits, including changes to a component whose plan already says it is done. File changes alone do not identify an agent or prove that a task succeeded.

Provider logs and hooks add session identity, tool activity, lifecycle events and native tasks where supported. Native tasks are the agent's temporary work list; they can change as a session progresses. Kitchen uses these for order tickets rather than inventing a task breakdown from the project plan.

| Available evidence | Map | Kitchen |
| --- | --- | --- |
| Local file changes | Yes | Yes |
| Durable `PLAN.md` | Component map and declared progress | Project context and role associations |
| Codex native activity and plans | Experimental local log adapter: sessions, tool activity, file trails and `update_plan` lists when the log contains them | Experimental local log adapter |
| Claude Code session/tool activity | Optional hooks | Local logs and optional hooks |
| Claude native task lists | Legacy `TodoWrite` and `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`, applied after the tool succeeds | Legacy lists and supported modern task results |
| Cursor native activity | No direct adapter; file/plan observation remains available | Optional hooks; native live validation pending |
| Confirmed artifact transfer | No receipt model; trails may suggest a handoff from timing | Explicit artifact revision and receipt metadata |

Local Codex and Claude collaboration has been exercised. The automated Kitchen checks run on Linux and macOS; Windows and native Cursor validation remain pending. Cloud sessions need accessible local logs or an explicit integration. [Kitchen discovery and connection limits](kitchen/CONNECTING.md)

## What the kitchen means

Suppose an agent reports “Implement the endpoint” and “Test validation” while building an API. These can appear as two order tickets. As the session researches, edits and runs checks, its contributions can be associated with different role chefs. When the native task reports completion, its dish travels to the deliverable table.

A chef is a responsibility, not necessarily a separate agent process. A single session can contribute through several chefs in sequence. The interface keeps the real provider/session identity available separately. Multiple sessions sharing a dish and passing confirmed artifacts require explicit bindings and receipt metadata; matching filenames or similar task names do not prove collaboration.

Treat the visuals as different kinds of evidence:

- **Reported:** plan status, native todos and supported lifecycle events supplied by the source.
- **Observed:** local file changes and recognized operations.
- **Inferred:** a responsibility or component associated with a file, task or operation. The interface labels these matches.
- **Unknown:** unavailable native tasks, missing history or an unsupported event format. Missing progress is not a fabricated percentage.

A completed dish means a native todo was reported complete. A deployment or published outcome needs its own evidence. Example mode is explicitly labeled and scripted.

## Current integration limits

Map and Kitchen have not yet consolidated their provider handling. Newer Map activity can still override Kitchen's native todo list, so use Kitchen independently when relying on its native-task display. Running both commands does not guarantee matching task histories. Map's hook setup now recognises its own relay, so either view's hooks can be installed first.

Map commits a native task change only after a recognised success. A failed, interrupted or unrecognised result keeps the last confirmed list. Kitchen's Codex and legacy plan adapters still accept a proposed list when its tool call starts.

Each Map run says what it knows in `evidence`: lifecycle events and `todos` are reported, tool activity is observed, its component is inferred from `files:` globs, and anything not available is `unknown`. An empty list that was reported is different from a session that never reported one.

Map reads Codex sessions whose working folder is inside the watched repo, from logs touched in the last two hours, and at most the last 2 MiB of each file. Older history in a larger log is not read, and the run's evidence says `history: partial`. Recent Codex versions run tools inside an `exec` wrapper and report most of them as completed items, including file changes. Plans made inside that wrapper do not appear in the log as an `update_plan` call, so those runs show their todos as unknown. Codex runs carry no terminal identity.

## What stays on your machine

Both services bind to `127.0.0.1`. They require no Agenttrail account, telemetry service, transcript upload or extra model call. The local browser uses bundled graphics/fonts or system fonts.

Kitchen processes bounded local log data and sends allowlisted activity metadata to its browser. Task titles and project paths can be visible; raw prompts, reasoning, command bodies and arbitrary tool outputs are excluded from that browser feed. Saved repo selection and connector registration live under `~/.agent-office` by default. Its order history is held in memory and reconstructed from available observations after restart.

Map's Claude hook relay sends hook payloads to local Map services, and Map reads local Codex logs without writing to them. The Map view can show shortened command text, search terms and other tool details for both, and saves recent activity, cycle summaries and log read positions under `~/.agenttrail`. It does not have Kitchen's narrower browser-field policy. Check visible details before sharing screenshots or recordings.

Map answers only requests with a local `Host`, and rejects any foreign `Origin`. Setup and starting a board also need a token that the Map page receives when it loads; each running board has its own, stored at `~/.agenttrail/tokens/<port>.token` for sibling boards to use. The hook endpoint takes no token, so installed relays keep working; any local process can post events to it, but a web page cannot.

Normal watching does not edit your repo. Explicit Map setup creates plan/instruction files and a `.gitignore` entry, and offers Claude hooks; noninteractive `init` assumes yes. Kitchen's optional **Connect agents** flow writes the reviewed provider hook configuration. Neither view sends agent prompts, approves provider actions or changes native task status.

[Start Kitchen](kitchen/README.md) · [Start Map](../README.md#run-the-project-map) · [Contribute](../CONTRIBUTING.md)
