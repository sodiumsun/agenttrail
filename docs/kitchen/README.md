# Agenttrail Kitchen

Kitchen is the experimental 3D observability view in **Agenttrail**, an open-source project for following AI coding agents' work. It turns available native tasks and observed activity into chefs, order tickets, ingredients and deliveries. Your agents keep working in their existing tools; the kitchen visualizes their work.

The other view, **Agenttrail Map**, shows project components, dependencies and file activity. Both live in this repository and run independently as local browser companions. They currently use separate services and provider adapters. Kitchen can read a running Map's context, but their activity coverage and histories differ. [Compare the two views](../../README.md#one-project-two-views) · [How observability works](../OBSERVABILITY.md)

![Full kitchen with chefs contributing to a shared task in a recorded Codex and Claude collaboration](overview.jpg)

## Start with your repo

Requires Node.js 20 or newer and a WebGL browser.

From your working repo:

```sh
npx agenttrail-kitchen .
```

The [npm package](https://www.npmjs.com/package/agenttrail-kitchen) includes prebuilt graphics and local fonts. No build step is required. To pin this experimental release, use `npx agenttrail-kitchen@0.1.0-alpha.3 .`. Contributors can [build from source](../../README.md#build-kitchen-from-source).

The browser opens at localhost:4780 or the next available port. Choose **Open repo** to switch folders. You can watch up to 12 roots without restarting agents. No PLAN.md is required; available native activity supplies the view. The source map command, `npx agenttrail`, keeps its existing behavior and installation footprint.

## Explore without running an agent

Add `--example` to the kitchen command, or click **Example** in the app. **Next example step** advances a labeled, scripted illustration of one session changing responsibilities while contributing to shared orders. It is not a recording of real providers. Click **Live** to return to the selected folder's observations.

## Read the kitchen

| What you see | What it means |
| --- | --- |
| Chef | A project responsibility, with actual assigned sessions visible in details |
| Order ticket and dish | An ephemeral native todo, following its reported wording and status |
| Chef cooking | Current observed work associated with that responsibility and dish |
| Ingredient plate | A recorded artifact revision or a clearly labeled workflow item |
| Plate transfer | Explicit receipt metadata; not a guess from matching filenames |
| Delivery conveyor | A newly completed native todo, not proof of a deployment or publication |
| Project map | Durable components, dependencies and configured outcomes |

One session can work through several chefs sequentially. Several sessions can contribute to one explicitly shared order. Similar todo titles alone do not establish collaboration. Inferred role matches stay labeled inferred. No native todo list means progress unknown.

Click a chef or ticket to inspect the evidence. Drag to pan, scroll to zoom, and use **Fit kitchen** or **Room view**. Motion pause and reduced motion stop decorative movement while live text still updates.

## Provider support

| Provider | Connection | Verification |
| --- | --- | --- |
| Codex | Experimental local logs | Real local collaboration exercised |
| Claude Code | Local logs; optional hooks | Real collaboration and native task receipts exercised |
| Cursor | Optional hooks | Automated coverage; native live validation pending |

Formats can change, and missing observations remain unknown. Only sessions with accessible local metadata can be discovered. [Connection details](CONNECTING.md) explain discovery limits and optional hook setup.

VS Code and Cursor can launch the browser companion from their integrated terminal. There is no Agenttrail Kitchen Marketplace extension or VSIX release yet. [Editor setup and troubleshooting](CONNECTING.md#vs-code-and-cursor)

## Customize and contribute

An optional `.office/kitchen.json` names responsibilities and groups rooms. The [portable workflow example](../../examples/kitchen-workflow) contains role/file mappings with no personal sessions or paths. Opening a project does not create this configuration automatically.

- [Shared dishes and native planning](SHARED-OUTCOMES.md)
- [Workflow configuration and role bindings](WORKFLOW-INTEGRATION.md)
- [Multiple kitchens](KITCHENS.md)
- [Explicit artifact receipts](HANDOFFS.md)
- [Contributing and checks](../../CONTRIBUTING.md)
- [Release notes](RELEASE.md)

The package is built from original project geometry and animation, using Three.js and locally bundled Nunito fonts. See [licenses and notices](../../packages/kitchen/docs/THIRD-PARTY.md). Soundtrack recordings and game-reference screenshots are excluded from the code distribution.
