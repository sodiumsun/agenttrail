# agenttrail

## Read the plan file {#plan-reader}
tech: PLAN.md parser + derived model
files: [bin/**]
- [x] Read the plan file into a live model {#plan-parse}
  by: claude
  tech: stable {#id}s, needs/links edges, [~] active marker
- [x] Re-read it the moment the agent edits it {#plan-watch}
  tech: fs watcher + 150ms debounce
- [x] Warn when the plan falls behind moving code {#plan-stale}
  by: claude
  from: agent
  tech: planStale in the model; topbar chip; SessionStart nudge injected via hooks
- [x] Lint the plan: structural warnings on the board {#plan-lint}
  by: claude
  tech: dup ids, unknown edge refs, uncited [x], missing files:, count governor

## Watch the repo {#watcher}
tech: recursive fs watcher
links: [explorer]
files: [bin/**]
- [x] Notice every file the agent touches {#watch-files}
  tech: heatFile/touchComponents in bin/agenttrail.mjs
  by: claude
- [x] Ignore editor droppings and junk folders {#watch-filter}
  tech: tmp/swap filter + .git, node_modules excludes

## Draw the live map {#map}
tech: svg flow diagram + task capsules
needs: [plan-reader]
links: [explorer]
files: [public/**, assets/brand/**]
- [x] Show components and how they connect {#map-graph}
  tech: needs = arrows, links = dashed, deterministic layout
  by: claude
- [x] Unfold a component into its tasks {#map-capsules}
  tech: zoomUnfolded + expandedGraphNode in public/index.html
  by: codex
- [x] Name things for the owner, not the agent {#map-naming}
  tech: convention v2 — verb-led titles + tech: sublines
- [x] Put the selected logo in the header {#map-logo}
  tech: .brand mark swap in public/index.html
  by: codex
- [x] Match the header logo to each theme {#map-theme-logo}
  by: codex
  from: agent
  tech: automatic header-logo swap in public/index.html
- [x] Recolor the app icon for dark mode {#map-theme-icon}
  by: codex
  from: agent
  tech: identical rounded-square composition and route mark, rendered in a darker night palette
- [x] Keep the header compact and the current map in view {#map-frame}
  by: codex
  from: agent
  tech: valid encoded favicon; one-row status rail; viewport-bound app shell
- [x] Switch the whole app between dark and light {#map-theme}
  by: codex
  from: agent
  tech: persisted top-bar switch + tokenized HTML/SVG surfaces in public/index.html
- [x] Make the theme switch name its action {#map-theme-label}
  by: codex
  from: agent
  tech: Light in dark mode; Dark in light mode
- [x] Strengthen completed task colors in light mode {#map-light-complete}
  by: codex
  from: agent
  tech: higher-contrast completion pill + clearer completed-task agent marks
- [x] Make revising cards prominent in light mode {#map-light-revising}
  by: codex
  from: agent
  tech: warm card tint + stronger orange outline and label
- [x] Bring running cards forward in light mode {#map-light-running}
  by: codex
  from: agent
  tech: warm active surface + stronger outline + accent-tinted depth
- [x] Keep past cycles out of the live map {#map-cycle-history}
  by: codex
  from: agent
  tech: canvas history control + closed-by-default right drawer in public/index.html

- [x] Knowledge components render with a purple accent {#map-knowledge-kind}
  tech: kind: knowledge parsed by KIND_RE; .gnode.knowledge tokens both themes
  by: claude
- [x] Set up an unmapped repo from its card {#map-setup-button}
  tech: Set up the map button -> /setup-board relay -> sibling /setup runs init
  by: claude
- [x] Cards with live work auto-unfold at any zoom {#map-live-unfold}
  tech: isUnfolded/compLive in public/index.html; folds back ~60s after activity stops
  by: claude
- [x] Human steps render dashed with an attention badge until their work clears {#map-human-kind}
  tech: kind: human + url: in the convention; amber ! while open tasks remain; OPEN link on cards
  by: claude
## Show the repo like an editor {#explorer}
tech: vs-code-style file tree
needs: [watcher]
files: [public/**]
- [x] Folder tree with live "just touched" accents {#explorer-tree}
  tech: renderTree + tree-ago in public/index.html
  by: claude
- [x] Make recent file edits stand out in light mode {#explorer-light-activity}
  by: codex
  from: agent
  tech: warm row tint + bright orange edge + semibold activity text
- [x] Add a repo from the sidebar {#explorer-add-repo}
  tech: + add repo row -> /suggest (known repos + git siblings) -> POST /spawn spawns a sibling daemon
  by: claude

## Watch live runs {#runs}
tech: claude code hooks adapter — PostToolUse/TodoWrite → POST /events
needs: [plan-reader]
links: [map]
files: [bin/**, public/**]
- [ ] Restrict Map actions to trusted local requests {#runs-request-boundary}
  tech: repository review reproduced missing Host/Origin validation and mutation authentication; add coverage for UI actions, hooks and cross-board relays.
- [ ] Keep Map and Kitchen hook setup independent {#runs-distinct-hooks}
  tech: Map's substring detection mistakes Kitchen's relay for its own; verify both installation orders and preserve unrelated hooks.
- [x] Receive hook events and track sessions {#runs-endpoint}
  by: claude
  tech: /events endpoint; per-session todos, current tool, recent calls
- [x] Hook relay command + settings install {#runs-relay}
  by: claude
  tech: agenttrail hook (stdin → POST, fail-silent); init merges .claude/settings.json
- [x] Run cards on the board with the live tool line {#runs-ui}
  tech: renderRuns in public/index.html
  by: claude
- [x] Pin runs to components so the map glows where work happens {#runs-pin}
  tech: run.componentId + obs-ring in public/index.html
  by: claude
- [x] Explain missing run cards in-product {#runs-explain}
  by: claude
  tech: hooksInstalled flag; hints for no-hooks and pre-hook sessions

- [x] Group live sessions into cycles in the runs dock {#runs-cycle-groups}
  tech: temporal burst grouping in renderRuns, public/index.html
  by: claude
- [x] Save ended cycles as durable history {#runs-cycle-history}
  tech: archiveRun + cycles[] persisted in bin/agenttrail.mjs; Past cycles rows in the dock
  by: claude
- [x] Sub-agents show as child rows on their parent's run card {#runs-subagents}
  tech: Task/SubagentStop hooks -> run.subagents in bin/agenttrail.mjs; .run-sub rows
  by: claude
## See the whole fleet {#fleet}
tech: /summary + /fleet aggregation; zoom-out altitude with live repo cards
needs: [runs]
links: [map]
files: [bin/**, public/**]
- [x] Zoom out past the map into the fleet view {#fleet-altitude}
  by: claude
  tech: repo cards — mini status map, live glow, agents present, current tool
- [x] Zoom is the detail dial: capsules auto-unfold as the camera closes {#fleet-semantic}
  by: claude
  tech: hysteresis 1.05/0.85; overlay toggles (activity, runs); run cards fly to their component
- [x] Draw each session's trail across the components it visited {#fleet-trails}
  by: claude
  tech: agent-colored dotted polylines under the edges, dimmed when the session ends
- [x] Show handoffs when one session picks up where another stopped {#fleet-handoffs}
  by: claude
  tech: daemon detects end-to-start ≤10min on a component; card shows from ⇄ to in agent colors
- [x] Zoom into a component's files {#fleet-l2}
  by: claude
  tech: L2 at 150% — files: globs ∩ tree, heat-sorted, agent mark on the hottest file
- [x] One world: repos as regions on a single map, no format switch {#fleet-world}
  by: claude
  from: agent
  tech: every board serves the merged world; regions LOD from card to components; multi-root sidebar; fleet page retired
- [x] Corner minimap with viewport jump {#fleet-minimap}
  by: claude
  tech: overview+detail per the research — status-colored nodes, click to jump

## Show agents cooking together {#kitchen}
tech: optional kitchen package, local observers, workflow model and Three.js renderer
files: [packages/kitchen/**]
links: [plan-reader, runs, map]
- [ ] Preserve native todos when Map reports newer activity {#kitchen-native-plan-precedence}
  tech: Projects.enrich currently lets a newer general Map event replace a confirmed native task list with empty board todos and withdraw its dishes.
- [ ] Confirm plan updates before serving completed dishes {#kitchen-plan-acknowledgements}
  tech: wait for successful Codex update_plan and legacy TodoWrite results; failed or interrupted calls must retain the last confirmed plan.
- [x] Bring the runnable kitchen into this repository {#kitchen-import}
  by: codex
  from: agent
- [x] Make the preview install without a graphics build {#kitchen-package}
  by: codex
  from: agent
- [x] Verify the packaged kitchen in a clean folder {#kitchen-package-check}
  by: codex
  from: agent
- [x] Start the kitchen through npm's installed command {#kitchen-bin-launch}
  by: codex
  from: agent
  tech: resolve the executable symlink before detecting the CLI entry point; verify actual npm exec rather than only the underlying file
- [x] Verify the public install observes a fresh working repo {#kitchen-public-readiness}
  by: codex
  from: agent
  tech: downloaded the exact public alpha.2 archive without GitHub credentials, matched its checksum, launched with a fresh npm cache, and observed this real working repo in the browser. All 71 tests pass. Expanded the package check to verify fresh logs over SSE, one session contributing through multiple chefs, native dish completion, and file observation; the public archive passes it.

## Ship to GitHub and npm {#ship}
needs: [map, explorer]
files: [README.md, docs/**, package.json, CONTRIBUTING.md, examples/**, .github/**]
- [x] Review reliability and explain the two observability views {#ship-observability-review}
  by: codex
  from: agent
  tech: reproduced four issues using real source modules and an isolated Map server; captured a local review with repro steps and suggested fixes. All 71 existing Kitchen tests pass. README and docs/OBSERVABILITY.md explain Map/Kitchen data sources, roles versus sessions, independent services, setup changes and different privacy policies; fixes remain open under runs and kitchen.
- [x] Publish the clarified observability guide {#ship-observability-guide}
  by: codex
  from: agent
  tech: PR #12 merged the overview, comparison, source diagram and accurate setup/provider guidance. Verified 38 documentation links and the public main README/guide. All Kitchen CI checks passed on Linux Node 20/22/24 and macOS Node 22. GitHub About now describes the two observability views; runtime findings remain open.
- [x] Show Kitchen clearly and document the verified setup {#ship-kitchen-readiness-docs}
  by: codex
  from: agent
  tech: merged PR #10 with a Kitchen-first README, public overview and cooking GIF, exact archive install command, browser/editor instructions and troubleshooting. Verified the public main README and media return HTTP 200. All 71 tests plus the expanded package check pass in CI on Linux Node 20/22/24 and macOS Node 22. Native extension, Cursor and Windows validation remain explicit gaps.
- [x] Explain how to try and contribute to the kitchen {#ship-kitchen-guide}
  by: codex
  from: agent
- [x] Publish a runnable experimental kitchen preview {#ship-kitchen-preview}
  by: codex
  from: agent
  tech: merged via PRs #8 and #9; kitchen-v0.1.0-alpha.2 includes a prebuilt archive and checksum. Public npm exec download, help and cold startup verified.
- [x] Publish the short kitchen command to npm {#ship-kitchen-registry}
  by: codex
  from: agent
  tech: agenttrail-kitchen@0.1.0-alpha.3 is public under latest. Downloaded it without credentials and matched its integrity and bytes to the tested archive. A fresh-cache npx launch opens a live repo and serves bundled assets without writing to the repo. All 71 tests pass; the public archive passes the installed-package/live-event check.
- [x] Publish the npm setup and matching release archive {#ship-kitchen-npm-guide}
  by: codex
  from: agent
  tech: PR #11 merged the short command, npm badge, pinned preview instructions and browser/editor limits. All 71 tests and package checks passed on Linux Node 20/22/24 and macOS Node 22. Published kitchen-v0.1.0-alpha.3 with the identical npm archive and SHA-256 checksum, verified its unauthenticated download and the public main README, and linked the new npm release from the older release notes.
- [x] Show cooking and deliveries through a closer video camera {#ship-kitchen-camera}
  by: codex
  from: agent
  tech: video sub-agent reframed original high-resolution footage into a 26.7-second edit with eased zooms, plate-transfer pans and conveyor tracking; music and silent exports remain local.
- [x] Propose how to release the kitchen inside Agenttrail {#ship-kitchen-structure}
  by: codex
  from: agent
  tech: package boundaries, shared event model, public preview and announcement in docs/KITCHEN-RELEASE-PLAN.md
- [x] Plan the companion virtual agent office {#ship-office-plan}
  by: codex
  from: agent
  tech: Research and visual alternatives in ../agent-office; planning only, no runtime changes
- [x] Public repo and readme {#ship-repo}
  tech: github.com/sodiumsun/agenttrail + README.md
- [x] Fresh demo gif of the current look {#ship-gif}
  tech: docs/demo.gif
  by: claude
- [x] Publish to npm {#ship-npm}
  by: claude
  tech: agenttrail@0.1.0 — npx agenttrail
- [x] First screen is alive with zero convention {#ship-empty}
  by: claude
  from: agent
  tech: live activity feed as the no-plan hero, backfill banner demoted
- [x] Filmed real-session demo video {#ship-video}
  tech: docs/demo.gif filmed from live boards
  by: claude
  from: agent
- [x] One-command first run {#ship-onboard}
  by: claude
  tech: virgin repo → inline consented init, browser opens by default, prompt on clipboard
- [x] Keep boards alive across reboots {#ship-lifecycle}
  by: claude
  tech: agenttrail up (relaunch known repos) + autostart (launchd/systemd)
- [x] Survive machines that aren't this one {#ship-portable}
  by: claude
  from: agent
  tech: free-port pickup, linux watcher fallback, windows paths, no-git repos
- [x] Say the trust line in the readme {#ship-trust}
  by: claude
  tech: README quick-start — 127.0.0.1 only, no telemetry, one readable file
- [x] Make the repo explain itself at a glance {#ship-readme-magic}
  by: codex
  tech: README.md — felt problem, visual proof, one-command start, trust, then depth
- [x] Make agenttrail easy to find and describe {#ship-discovery}
  by: codex
  tech: README definition, sentence-case headings, npm metadata, GitHub description and topics

## decisions
- 2026-09-09: Review the public repository for concrete reliability and setup issues, recording reproducible findings separately from planned features. Describe Agenttrail as the local observability project with two views: Agenttrail Map for project structure and activity, and Agenttrail Kitchen for native tasks and role contributions. Document their current independent services and differing provider support rather than implying a unified event backend or agent orchestration.
- 2026-09-08: Publish Kitchen to npm now that the owner has restored registry login. Use alpha.3 for the refreshed package README instead of changing the existing alpha.2 archive; keep the experimental version explicit and use the latest tag so npx agenttrail-kitchen . works. Verify the exact public package from a fresh consumer environment, then publish matching GitHub release assets and setup instructions. The owner chose browser setup first; no editor extension is being added.
- 2026-09-08: Audit the downloadable public Kitchen release from an isolated consumer install, verify real repo observation and adapter behavior, fix launch gaps, and refresh the root README with Kitchen screenshots and exact install/support instructions. No editor extension currently exists; clarify whether the owner wants one built or wants the working browser setup documented. Keep unknown integration status explicit.
- 2026-09-08: The public archive check exposed a symlink entry-point bug: invoking the underlying file worked, but npm's installed command exited without calling main. Fix the entry-point detection and test actual npm exec. Supersede the first preview with alpha.2 rather than silently replacing the published archive.
- 2026-09-08: The owner approved bringing Kitchen into Agenttrail and releasing an experimental preview. Add the kitchen component because the working scene, observers and packaging own packages/kitchen/** and the release now depends on them. Keep the existing map package unchanged; share more runtime code in subsequent work. Import runtime assets, tests and relevant docs, excluding personal logs, reference screenshots and music. A separate video-editing sub-agent is preparing smooth camera moves from the real footage.
- 2026-09-08: Prepare a release-structure recommendation for bringing the built kitchen into Agenttrail. The proposal keeps one repository and an optional kitchen package; package migration and publication are not part of this planning change.
- 2026-09-08: Explore a visually distinct virtual office in sibling ../agent-office. This session produces research, proposed architecture, must-build scope, and comparable visual concepts only. Keep proposed future components in the companion brief until implementation makes them real; do not add speculative components to the existing map.
- 2026-08-30: cycles + kind: knowledge + card-setup graduated into the plan after the board flagged PLAN BEHIND — the observed layer caught an undeclared build burst
- 2026-08-21: spine is the codebase (fs watcher + PLAN.md), not agent hooks; hooks become an optional fidelity adapter
- 2026-08-21: serve index.html fresh per request (no startup cache) so UI edits land without daemon restart
- 2026-08-21: filter editor atomic-write tmp files from the activity signal
- 2026-08-21: graph is hand-rolled svg, not react-flow — keeps the daemon zero-dep and the page build-free
- 2026-08-23: K. removed the plan-changes mechanism entirely — agenttrail is a live read-only status monitor
- 2026-08-23: convention v2 — plan nodes are components (needs + links edges), titles are plain verb-led outcomes for the owner with tech: sublines; layout stays deterministic, the authoring agent is the generative part
- 2026-08-23: run foreground, map as stage — hooks adapter is core (the 30-minute question is the product); file spine stays the fallback for hook-less agents
- 2026-08-23: README leads with the moment agenttrail solves (returning to a long agent run and knowing exactly where it is), proves it with the live demo, then earns trust before exposing the full spec
- 2026-08-23: discovery position is "a local observability layer and live project map for AI coding agents"; distinguish it from LLM trace and cost dashboards with current plans, tool calls, file changes, progress, and revisions, using direct definitions and repository topics instead of keyword stuffing
- 2026-08-27: infinity map scoped as altitudes, not canvas soup — fleet (parallel agents) > board > capsules; zoom is the switcher; data-flow edges deferred until observable
- 2026-08-27: zoom model doc'd in docs/ZOOM.md — space is zoomable (containment only), work is overlay paint at its address; tasks are Plan-overlay annotations, never zoom destinations; symbols + data-flow deferred
- 2026-08-27: fleet page retired — the world IS the map; regions LOD from name-card to full board at 30%; tabs and run cards fly the camera instead of navigating; sidebar is multi-root with lazy sibling trees
- 2026-08-27: light mode is a token-only UI variant — dark stays the default, the top-bar switch persists locally, and no layout or product behavior changes
- 2026-08-27: theme branding uses one app-icon design — light keeps the colorful original; dark is the same rounded-square composition in a night palette
- 2026-08-29: archived cycles are secondary history, not live run cards — open them from the canvas controls in a right-side drawer so the map stays primary
