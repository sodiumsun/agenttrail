# Agenttrail for pi

Shows your [pi](https://pi.dev) sessions on [Agenttrail Map](https://github.com/sodiumsun/agenttrail), the live local map of what each coding agent is working on. Each pi session becomes a run card with its current tool, recent tools, the files it writes and, if you use a `todo` tool, its todo list.

```sh
pi install npm:agenttrail-pi   # or copy index.js to ~/.pi/agent/extensions/agenttrail.js
npx agenttrail                                    # in your repo, if Map isn't running yet
```

The extension posts to Map boards on `127.0.0.1` ports 5330 to 5344, and each board keeps only sessions working inside its repo. Set `AGENTTRAIL_PORT` to target one board. It sends tool names, paths, shell commands and search patterns, never file contents or prompts. When no board is running the posts fail silently, and pi never waits more than 400ms on one.

Built on Map's [ingest events](../../docs/INGEST.md), which any agent can use.
