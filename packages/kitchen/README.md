# Agenttrail Kitchen

Your coding agents, cooking together. An experimental 3D view in [Agenttrail](https://github.com/sodiumsun/agenttrail), a local, open-source monitor for coding agents.

Native todos become order tickets, project responsibilities become chefs, and completed todos travel to the deliverable table. Several chefs can contribute to one dish. A chef is a role, so one actual session can work through several chefs; the interface keeps session counts separate. Confirmed artifact receipts can animate plates moving between contributors.

## Try the preview

Requires Node.js 20 or newer and a browser with WebGL. From the repo you want to watch, run the prebuilt [Kitchen preview release](https://github.com/sodiumsun/agenttrail/releases/tag/kitchen-v0.1.0-alpha.1):

```sh
npm exec --yes --package=https://github.com/sodiumsun/agenttrail/releases/download/kitchen-v0.1.0-alpha.1/agenttrail-kitchen-0.1.0-alpha.1.tgz -- agenttrail-kitchen .
```

The published archive includes the graphics bundle and local fonts. It has no runtime npm dependencies and needs no graphics build. The short npm registry command is not available until this package is published there.

The browser opens on localhost, using port 4780 or the next available port. Keep your agents working in their current tools. No PLAN.md or Agenttrail setup is required in the watched repo. Opening a repo reads its available activity; it does not modify the repo or launch agents.

To explore without running an agent, add `--example` or click **Example**, then **Next example step**. The example is clearly labeled and uses scripted activity. Live observation of the selected folder stays available behind the Live button.

## What connects

| Provider | Current preview support |
| --- | --- |
| Codex | Experimental local log adapter; exercised in the recorded collaboration. Available lifecycle, tool and native plan metadata drive the view. |
| Claude Code | Experimental local logs and optional additive hooks; exercised with Codex, including native task acknowledgements. |
| Cursor | Optional hooks with automated adapter tests; native live validation is still pending. |

Local file watching remains available without native todos. Missing tasks or progress stay unknown. Remote sessions whose logs are not on this machine are not automatically visible. Explicit artifact/revision/receipt metadata is required for reliable plate transfers; ordinary file reads do not establish a handoff.

Choose **Connect agents** to review optional Claude or Cursor hook changes. Installation is additive, reversible and explicit. The kitchen never sends prompts, approves actions or changes task status in your agents.

## Develop from source

From the repository root:

```sh
npm ci --prefix packages/kitchen
npm run build --prefix packages/kitchen
npm start --prefix packages/kitchen -- --project /absolute/path/to/your/repo
```

After frontend changes, rebuild and reload. To check and package:

```sh
cd packages/kitchen
npm run check
npm test
npm pack
node scripts/check-package.mjs ./agenttrail-kitchen-0.1.0-alpha.1.tgz
```

The package smoke check installs into an isolated temporary folder without lifecycle scripts or development dependencies, launches the installed command, verifies bundled assets and checks repo attachment. It does not use your real agent logs or saved kitchen state.

## Learn more

- [Quick start and scene controls](https://github.com/sodiumsun/agenttrail/tree/main/docs/kitchen)
- [Connection details and limits](https://github.com/sodiumsun/agenttrail/blob/main/docs/kitchen/CONNECTING.md)
- [Roles and shared orders](https://github.com/sodiumsun/agenttrail/blob/main/docs/kitchen/WORKFLOW-INTEGRATION.md)
- [Artifact receipt contract](https://github.com/sodiumsun/agenttrail/blob/main/docs/kitchen/HANDOFFS.md)
- [Contributing](https://github.com/sodiumsun/agenttrail/blob/main/CONTRIBUTING.md)

## License and privacy

MIT for the project code and original kitchen assets. [Third-party notices](docs/THIRD-PARTY.md) cover Three.js and Nunito. The game-reference screenshots and soundtrack are not included; this is an independent, cooking-game-inspired project.

The service binds to 127.0.0.1. Rendering, fonts and event delivery stay local. There is no account, telemetry, transcript upload or extra model call. Only allowlisted activity metadata reaches the browser; task titles and project paths may still be visible when you record or share your screen.
