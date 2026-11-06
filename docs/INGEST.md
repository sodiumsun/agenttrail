# Reporting runs from any agent

Map reads Claude Code and Codex from their local logs. Any other agent can show up the same way by posting events to the boards on this machine. That agent might be a CLI, an editor extension or a harness plugin. Map's own Claude Code hooks use this endpoint, so it is the same path, not a side door.

The [pi extension](../integrations/pi) is a complete example in about 50 lines.

## Where to post

`POST http://127.0.0.1:<port>/hook` with a JSON body, for each port from 5330 to 5344. Each board keeps only events whose `cwd` is inside its repo and ignores the rest, so posting to every port is correct. If `AGENTTRAIL_PORT` is set, post to that port only.

- No token is needed. Requests must come from 127.0.0.1, and a request carrying a browser `Origin` from another site is refused.
- Always answers `200`. Bodies up to 16 MiB are read, but keep events small.
- Never block your agent on it. Use a short timeout (Map's relay uses 400ms) and ignore failures: no board running is the normal case.

## Fields on every event

| Field | Required | Meaning |
| --- | --- | --- |
| `hook_event_name` | yes | One of the events below |
| `cwd` | yes | Absolute path the agent is working in |
| `session_id` | yes | Stable id for this session. One id is one run card |
| `agent` | yes for non-Claude agents | Short name shown on the card, e.g. `pi`. Lowercased, 24 characters max. Without it, the run is labelled `claude` |
| `hc_terminal_id` | no | Terminal id, to tell two agents in one repo apart |

## Events

| `hook_event_name` | Extra fields | Effect |
| --- | --- | --- |
| `SessionStart` | `source`: `startup`, `resume` or `clear` | Opens the run, waiting for a prompt |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` | The run is active and shows this tool as current |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `files_written` | Records the finished tool and marks written files |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `tool_use_id` | Records the tool as failed |
| `TodoUpdate` | `todos` | Replaces the run's task list |
| `Stop` | | The agent finished its turn and is idle |
| `SessionEnd` | | The session is over |
| `SubagentStop` | | The oldest open sub-agent row finishes |

`tool_input` supplies the one-line detail on the card. The first present field wins: `command`, `file_path`, `description`, `pattern`, `url`, `query`, `prompt`. Send only short descriptive fields, never file contents. `file_path` on a `PostToolUse` also counts as a written file, so for a read, put the path in `description` instead.

`files_written` is a list of paths, relative to `cwd` or absolute, that the call changed. At most 50 are read. These paths pin the run to the plan component that owns the files and light up the file trail.

`todos` is the whole current list: `[{ "content": "Wire the relay", "status": "in_progress", "id": "1" }]`. `status` must be `pending`, `in_progress` or `completed`. `title` is accepted for `content`, and `id` is optional. Items with any other status are dropped, and a `todos` that is not a list changes nothing.

## Example

```sh
curl -s -X POST http://127.0.0.1:5330/hook -d '{
  "hook_event_name": "PostToolUse", "agent": "my-agent", "session_id": "abc",
  "cwd": "'"$PWD"'", "tool_name": "edit", "tool_input": { "description": "src/app.js" },
  "files_written": ["src/app.js"] }'
```

Something built on this? Open an issue and we'll list it in the README.
