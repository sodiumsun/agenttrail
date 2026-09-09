# Kitchen preview 0.1.0-alpha.2

Agenttrail Kitchen is now part of the Agenttrail source tree under `packages/kitchen`. This is an experimental preview of the existing festival kitchen, not a rewrite of the map.

Alpha.2 fixes startup through npm's installed executable symlink. The first archive's underlying Node file worked, but the npm command could exit without opening a kitchen. The package check now runs actual `npm exec` for help, live repo attachment and example launch. Use alpha.2 rather than alpha.1.

## Included

- Local 3D kitchen with project-adapted chefs, native todo dishes, shared contributions, a delivery conveyor and explicit artifact receipts.
- Standalone repo selection and optional integration with an existing Agenttrail board.
- Experimental local Codex and Claude adapters, plus optional Claude/Cursor hooks with reviewable additive setup.
- Labeled Example mode, also accessible with `--example`.
- Prebuilt graphics, local fonts, original project assets and license notices in the installable archive.
- Portable role configuration, contributor guide, issue template and a clean-package smoke check.

The existing map daemon, interface and package metadata are unchanged. The root README now links the optional kitchen.

## Verification

- Graphics build and syntax checks pass.
- All 71 kitchen tests pass, including native task receipts, role/session identity, shared orders, explicit handoffs, path isolation and connector setup.
- The archive installs offline into a fresh folder with no lifecycle scripts or development dependencies. Its installed launcher attaches a folder containing spaces and shell metacharacters correctly, serves its bundled assets and opens the labeled example URL.
- Browser verification from the isolated installed archive shows the 3D scene, a Researcher → Writer contribution on the same dish, and completion moving that dish to the deliverable collection. The scene correctly reports five roles and one example session.
- The 71 tests and clean-package check also pass in CI on Linux with Node 20, 22 and 24. See the release's associated commit checks for their results.

Earlier native Codex/Claude collaboration was recorded before this import. Native Cursor validation and Windows-specific browser/CLI validation remain pending. No broader support claim is implied by the example mode.

## Distribution

The first preview uses a [GitHub prerelease](https://github.com/sodiumsun/agenttrail/releases/tag/kitchen-v0.1.0-alpha.2) with an installable `agenttrail-kitchen-0.1.0-alpha.2.tgz`. npm authentication is currently unavailable, so the registry package and short `npx agenttrail-kitchen` command are not yet published.

The archive has no runtime npm dependencies. Its built browser bundle includes Three.js; fonts retain their OFL license. It excludes tests, development scripts, original source scene modules, native transcripts, personal configuration, raw recordings, music and reference screenshots. Complete editable source and tests remain in the repository.

## Known limits

Roles are not independent processes. Native todos are shown only when available. Inter-agent artifact transfers require explicit revision/receipt metadata. Logs are local and observation is bounded; cloud sessions without local logs are not discovered automatically. Order and artifact history is currently in memory and restarts reconstruct only available observations.

Future work includes shared map/kitchen event handling, native Cursor validation and additional visual themes. These are not required to run this preview.
