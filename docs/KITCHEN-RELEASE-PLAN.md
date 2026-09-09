# Release Agenttrail Kitchen

Status: approved and implemented for the first experimental preview. See [release details](kitchen/RELEASE.md) for verification and distribution status.

## One project, two views

Use **Agenttrail** as the project name and **Agenttrail Kitchen** as its optional 3D view. The map explains project structure and activity; the kitchen makes the same work visible as a collaborative cooking scene. Use one GitHub repository, issue tracker, documentation entry point, and contribution process.

The map remains a small dependency-free Node package. The kitchen has been imported under `packages/kitchen`, with MIT licensing, a package file allowlist and its own Node service and Three.js build. It reads Agenttrail board data and also parses plans and provider activity itself. The views belong to one project but do not yet share one runtime.

## Repository and installation

For the first public preview, keep the existing map package in place and import the kitchen as an independently runnable package:

```text
agenttrail/
  bin/                       existing Agenttrail command
  public/                    existing map
  packages/
    kitchen/
      bin/                   kitchen launcher and local relays
      src/                   observers, event state and local service
      public/                scene, characters and interface
      scripts/               bundle the renderer
      test/
      package.json
  docs/
    kitchen/                 quick start, connection limits, event model
  examples/
    kitchen-workflow/        portable roles and a labeled example
  LICENSE
  CONTRIBUTING.md
```

The package is `agenttrail-kitchen@0.1.0-alpha.1`. The preview is distributed as a prebuilt GitHub release archive because npm registry authentication is currently unavailable. The short `npx agenttrail-kitchen` command must not be advertised as available until registry publication succeeds. The archive includes built graphics and local fonts, has an explicit file allowlist and has no runtime npm dependencies. The existing `npx agenttrail` package and command remain unchanged.

After the optional package works, offer a convenient `agenttrail kitchen` launcher and Map/Kitchen navigation that preserve the selected repo. That launcher is a later interface change, not an existing command.

## Shared meaning before more themes

Consolidate the duplicated plan and provider handling incrementally after the import. Both views should eventually subscribe to one local event stream and model. Keep kitchen geometry, characters and animation separate from provider adapters and task state. A future space-station or fire-station view can reuse those events and change its scene and presentation.

The shared model must distinguish:

| Product fact | Kitchen presentation |
| --- | --- |
| Actual provider session/executor | Source of observed work; provider badge and session count |
| Project responsibility/role | Persistent chef; several roles may belong to one session |
| Ephemeral native todo | Dish and evolving order ticket |
| Durable component or outcome | Project map context or destination table; not fabricated todo progress |
| Observed contribution to a todo | Chef works on that dish |
| Explicit artifact revision and receipt | Plate transfer with provenance |

Inferred roles remain labeled inferred. One session moving between roles does not establish parallel execution. Handoffs inferred from timing remain distinct from acknowledged artifact receipts. Missing native tasks or progress remain unknown. Switching views must not create new activity or start agents.

## Make the preview useful to contributors

1. Import only the runtime, tests, useful documentation and original project assets. Preserve the existing map behavior and package contents.
2. Apply the existing MIT license to code the owner is entitled to license; retain Three.js MIT and Nunito OFL notices. Keep the soundtrack compilation and game-reference screenshots outside the open-source distribution.
3. Provide one copyable quick start and an explicit example mode for people without agents running. Clearly label examples and replays. Test a packed package in a clean folder, not just the development checkout.
4. Publish a short compatibility table: Codex and Claude local integration were exercised in the demo; native Cursor validation is pending. Explicit handoff metadata is required for reliable artifact receipts. Remote sessions without local logs are not automatically visible.
5. Move only a sanitized version of the Maze Shift role/example configuration. Do not include `.runs`, personal paths, native transcripts, saved local connection state or the full raw recordings.
6. Run the existing kitchen checks plus install/launch verification, then publish an experimental release with a runnable source link. Make issue labels for kitchen visuals, provider adapters and first-run problems.

## Announce it with the kitchen clip

Use the 22-second kitchen-only video as the main post. Introduce the experience, identify the demo as real Codex and Claude work, and link the runnable preview and setup instructions. Invite people to try their own repos and report integration gaps. Use “Overcooked-inspired” as the inspiration, while retaining Agenttrail Kitchen as the product name.

The music edit uses the owner's supplied MP3 from 10:25.000 to 10:46.833. Public promotional use needs to be covered by the owner's applicable music licence; an MIT software release does not grant rights to the soundtrack. Audio Network offers [social and promotional licensing](https://us.audionetwork.com/licensing) and sets out its [usage terms](https://www.audionetwork.com/terms-and-conditions). Use the silent cut or another suitably licensed track if that coverage is unavailable.

Promotion videos are separate from the software distribution. Only the original kitchen screenshot is included in these docs; native logs, raw recordings and soundtrack files are excluded.

Do not describe the kitchen as published until its code is in the public repository. A post made before then should call it a work-in-progress preview.
