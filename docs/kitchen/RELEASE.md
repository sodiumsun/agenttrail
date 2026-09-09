# Kitchen preview 0.1.0-alpha.3

Agenttrail Kitchen is now part of the Agenttrail source tree under `packages/kitchen`. This is an experimental preview of the existing festival kitchen, not a rewrite of the map.

Alpha.3 is the first npm release. From the local repo you want to watch, run:

```sh
npx agenttrail-kitchen .
```

Requires Node.js 20 or newer and a WebGL browser. The package includes built graphics and local fonts; no source build is required. This is still an experimental preview. Use `npx agenttrail-kitchen@0.1.0-alpha.3 .` to pin this version, or add `--example` to explore a labeled scripted example without running agents.

The runtime matches alpha.2; this release updates package metadata, setup instructions and distribution. Alpha.2 fixed startup through npm's installed executable symlink. Alpha.1 is superseded.

## Included

- Local 3D kitchen with project-adapted chefs, native todo dishes, shared contributions, a delivery conveyor and explicit artifact receipts.
- Standalone repo selection and optional integration with an existing Agenttrail board.
- Experimental local Codex and Claude adapters, plus optional Claude/Cursor hooks with reviewable additive setup.
- Labeled Example mode, also accessible with `--example`.
- Prebuilt graphics, local fonts, original project assets and license notices in the installable archive.
- Portable role configuration, contributor guide, issue template and a clean-package smoke check.

The existing map daemon, interface and package metadata are unchanged. The root README includes the Kitchen overview, a silent cooking clip, and browser setup for agent/editor users. No editor extension is released.

## Verification

- The public npm archive was fetched without credentials, and its bytes and integrity matched the tested archive exactly.
- The actual short `npx` command launched a new live kitchen from a fresh npm cache and empty npm configuration. Bundled graphics and fonts loaded; the watched folder stayed unchanged and no sessions were invented for an empty repo.
- The public alpha.3 archive passes the installed-package check: fresh native events arrive over SSE, one session contributes through multiple chefs to one dish, native completion reaches its table, and independent file observation works.
- Graphics build and syntax checks pass.
- All 71 kitchen tests pass, including native task receipts, role/session identity, shared orders, explicit handoffs, path isolation and connector setup.
- The archive installs offline into a fresh folder with no lifecycle scripts or development dependencies. Its installed launcher attaches a folder containing spaces and shell metacharacters correctly, serves its bundled assets and opens the labeled example URL.
- Browser verification from the isolated installed archive shows the 3D scene, a Researcher → Writer contribution on the same dish, and completion moving that dish to the deliverable collection. The scene correctly reports five roles and one example session.
- The exact public GitHub-download command was exercised after publication: help prints correctly and a new isolated kitchen starts successfully in Example mode.
- The public archive was downloaded again without GitHub authentication and its SHA-256 matched the release. A fresh npm cache and empty npm user configuration launched that exact archive against an existing working repo; current Codex activity appeared in the browser without changing repo settings.
- The expanded installed-package check appends synthetic native logs after attachment and verifies new events over SSE, one actual session moving between role chefs on one shared dish, native completion reaching the deliverable table, and file changes appearing independently. This check passes against the published alpha.2 archive, not only source imports.
- The public install's browser was checked in both Live and Example: the 3D scene renders, source labels remain explicit, Researcher → Writer contribution is preserved, and a completed dish reaches the table. No browser errors were reported.
- The 71 tests and clean-package check also pass in CI on Linux with Node 20, 22 and 24 and macOS with Node 22. See the release's associated commit checks for their results.

Earlier native Codex/Claude collaboration was recorded before this import. Native Cursor validation and Windows-specific browser/CLI validation remain pending. No broader support claim is implied by the example mode.

## Distribution

The [npm package](https://www.npmjs.com/package/agenttrail-kitchen) publishes `0.1.0-alpha.3` under the `latest` tag so the short command resolves. The matching [GitHub prerelease](https://github.com/sodiumsun/agenttrail/releases/tag/kitchen-v0.1.0-alpha.3) contains the same `agenttrail-kitchen-0.1.0-alpha.3.tgz` and a SHA-256 checksum. Earlier GitHub archives remain available unchanged.

Alpha.3 archive SHA-256: `326d4b405dd1991519f3cf2fb8152b0e7deb5fe01b38c756e8dd5bbaacee070f`.

The archive has no runtime npm dependencies. Its built browser bundle includes Three.js; fonts retain their OFL license. It excludes tests, development scripts, original source scene modules, native transcripts, personal configuration, raw recordings, music and reference screenshots. Complete editable source and tests remain in the repository.

## Known limits

Roles are not independent processes. Native todos are shown only when available. Inter-agent artifact transfers require explicit revision/receipt metadata. Logs are local and observation is bounded; cloud sessions without local logs are not discovered automatically. Order and artifact history is currently in memory and restarts reconstruct only available observations.

Future work includes shared map/kitchen event handling, native Cursor validation and additional visual themes. These are not required to run this preview.
